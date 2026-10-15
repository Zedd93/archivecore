import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import qr from '../../shared/src/utils/qr.ts';
import stateMachine from '../src/modules/orders/order-state-machine.ts';
import schemas from '../../shared/src/validators/order.schema.ts';

const require = createRequire(import.meta.url);
const { generateQrData, generateFolderQrData } = qr;
const { matchOrderItemQr } = require('../../client/src/utils/orderPicking.ts');
const { getOrderItemPickLocation, sortOrderItemsByPickRoute } = require('../../client/src/utils/orderPickRoute.ts');
const { SerialScanQueue } = require('../../client/src/utils/serialScanQueue.ts');
const { canMarkReadyAfterPicking } = stateMachine;
const { updateOrderItemStatusSchema, deliverOrderSchema } = schemas;

const boxId = 'f411a4d4-904a-4779-b697-5df8ba29a976';
const folderId = '9ff32a6e-818e-42ec-b35b-cd9c038758d7';
const boxCode = generateQrData('DOX', 'K-2026-000001');
const folderCode = generateFolderQrData(folderId);

test('box QR picks only a direct box item, not a folder in that box', () => {
  const items = [
    { id: 'box-item', itemStatus: 'pending', boxId, box: { qrCode: boxCode } },
    { id: 'folder-item', itemStatus: 'pending', folderId, box: { qrCode: boxCode } },
  ];
  assert.deepEqual(matchOrderItemQr(items, boxCode), { kind: 'match', item: items[0] });
  assert.deepEqual(matchOrderItemQr(items, folderCode), { kind: 'match', item: items[1] });
  assert.equal(matchOrderItemQr([items[1]], boxCode).kind, 'missing');
});

test('unknown, corrupted and ambiguous QR codes cannot pick an item', () => {
  assert.equal(matchOrderItemQr([], boxCode).kind, 'missing');
  const badChecksum = `${boxCode.slice(0, -1)}${boxCode.endsWith('0') ? '1' : '0'}`;
  assert.equal(matchOrderItemQr([], badChecksum).kind, 'invalid');
  assert.equal(matchOrderItemQr([{ id: 'a', itemStatus: 'pending', folderId }, { id: 'b', itemStatus: 'pending', folderId }], folderCode).kind, 'ambiguous');
});

test('rapid scans wait for the preceding pick to finish', async () => {
  const nextBoxId = '0d4bd19a-e44c-43b1-bdb5-672682135104';
  const nextCode = generateQrData('DOX', 'K-2026-000002');
  const items = [
    { id: 'first', itemStatus: 'pending', boxId, box: { qrCode: boxCode } },
    { id: 'second', itemStatus: 'pending', boxId: nextBoxId, box: { qrCode: nextCode } },
  ];
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  const picked = [];
  const errors = [];
  const queue = new SerialScanQueue(async (code) => {
    const match = matchOrderItemQr(items, code);
    assert.equal(match.kind, 'match');
    if (code === boxCode) await firstPending;
    match.item.itemStatus = 'picked';
    picked.push(match.item.id);
  }, (error) => errors.push(error));

  assert.equal(queue.enqueue(boxCode), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.enqueue(nextCode), true);
  assert.equal(queue.enqueue(nextCode), false);
  assert.deepEqual(picked, []);
  releaseFirst();
  await queue.whenIdle();
  assert.deepEqual(picked, ['first', 'second']);
  assert.deepEqual(errors, []);
});

test('checkout requires every item picked before it is ready', () => {
  assert.equal(canMarkReadyAfterPicking('checkout', []), false);
  assert.equal(canMarkReadyAfterPicking('checkout', ['picked', 'pending']), false);
  assert.equal(canMarkReadyAfterPicking('checkout', ['picked', 'picked']), true);
  assert.equal(canMarkReadyAfterPicking('checkout', ['picked', 'delivered', 'returned']), true);
  assert.equal(canMarkReadyAfterPicking('checkout', ['picked', 'issue']), false);
  assert.equal(canMarkReadyAfterPicking('return_order', ['pending']), true);
});

test('item status endpoint accepts only pick and undo-pick', () => {
  assert.equal(updateOrderItemStatusSchema.safeParse({ status: 'picked' }).success, true);
  assert.equal(updateOrderItemStatusSchema.safeParse({ status: 'pending' }).success, true);
  assert.equal(updateOrderItemStatusSchema.safeParse({ status: 'delivered' }).success, false);
  assert.equal(updateOrderItemStatusSchema.safeParse({ status: 'returned' }).success, false);
});

test('handover proof validates recipient and complete optional coordinates', () => {
  const signatureData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4AWP8DwQMQMDEAAUAPfgEADYYS7QAAAAASUVORK5CYII=';
  assert.equal(deliverOrderSchema.safeParse({}).success, true);
  assert.equal(deliverOrderSchema.safeParse({ proof: { recipientName: ' Anna Kowalska ' } }).data?.proof?.recipientName, 'Anna Kowalska');
  assert.equal(deliverOrderSchema.safeParse({ proof: { recipientName: 'A' } }).success, false);
  assert.equal(deliverOrderSchema.safeParse({ proof: { recipientName: 'Anna Kowalska', latitude: 50.1 } }).success, false);
  assert.equal(deliverOrderSchema.safeParse({ proof: { recipientName: 'Anna Kowalska', latitude: 50.1, longitude: 18.6, accuracyMeters: 12 } }).success, true);
  assert.equal(deliverOrderSchema.safeParse({ proof: { recipientName: 'Anna Kowalska', latitude: 91, longitude: 18.6, accuracyMeters: 12 } }).success, false);
  assert.equal(deliverOrderSchema.safeParse({ proof: { recipientName: 'Anna Kowalska', signatureData } }).success, true);
  assert.equal(deliverOrderSchema.safeParse({ proof: { recipientName: 'Anna Kowalska', signatureData: 'data:image/svg+xml;base64,PHN2Zz4=' } }).success, false);
  assert.equal(deliverOrderSchema.safeParse({ proof: { recipientName: 'Anna Kowalska', boxChecks: [{ boxId, condition: 'intact', sealNumber: ' P-12 ' }] } }).data?.proof?.boxChecks?.[0].sealNumber, 'P-12');
  assert.equal(deliverOrderSchema.safeParse({ proof: { recipientName: 'Anna Kowalska', boxChecks: [{ boxId, condition: 'damaged' }] } }).success, false);
  assert.equal(deliverOrderSchema.safeParse({ proof: { recipientName: 'Anna Kowalska', boxChecks: [{ boxId, condition: 'damaged', conditionNote: 'Rozerwany narożnik' }] } }).success, true);
  assert.equal(deliverOrderSchema.safeParse({ proof: { recipientName: 'Anna Kowalska', boxChecks: [{ boxId, condition: 'intact' }, { boxId, condition: 'intact' }] } }).success, false);
});

test('pick route sorts locations and box numbers naturally, leaving unlocated items last', () => {
  const items = [
    { id: 'unlocated', itemStatus: 'pending', folder: { box: { boxNumber: 'K-3' } } },
    { id: 'shelf-10', itemStatus: 'pending', box: { boxNumber: 'K-1', location: { fullPath: 'Magazyn / Półka 10' } } },
    { id: 'box-10', itemStatus: 'pending', folder: { box: { boxNumber: 'K-10', location: { fullPath: 'Magazyn / Półka 2' } } } },
    { id: 'box-2', itemStatus: 'picked', document: { folder: { box: { boxNumber: 'K-2', location: { fullPath: 'Magazyn / Półka 2' } } } } },
    { id: 'box-2-pending', itemStatus: 'pending', transferListItem: { box: { boxNumber: 'K-2', location: { fullPath: 'Magazyn / Półka 2' } } } },
  ];
  assert.deepEqual(sortOrderItemsByPickRoute(items).map((item) => item.id), [
    'box-2-pending', 'box-2', 'box-10', 'shelf-10', 'unlocated',
  ]);
  assert.equal(getOrderItemPickLocation(items[0]), null);
  assert.deepEqual(items.map((item) => item.id), ['unlocated', 'shelf-10', 'box-10', 'box-2', 'box-2-pending']);
});

test('pick route resolves a transfer-list folder or HR folder when the direct box is absent', () => {
  assert.equal(getOrderItemPickLocation({
    id: 'transfer', itemStatus: 'pending', transferListItem: { folder: { box: { boxNumber: 'K-1', location: { fullPath: 'Shelf A' } } } },
  }), 'Shelf A');
  assert.equal(getOrderItemPickLocation({
    id: 'hr', itemStatus: 'pending', hrFolder: { box: { boxNumber: 'K-2', location: { fullPath: 'Shelf B' } } },
  }), 'Shelf B');
});
