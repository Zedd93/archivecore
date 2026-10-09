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
const { canMarkReadyAfterPicking } = stateMachine;
const { updateOrderItemStatusSchema } = schemas;

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
