import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateQrData, generateFolderQrData } = require('../../shared/src/utils/qr.ts');
const { matchActiveLoansByQr } = require('../../client/src/utils/loanReturn.ts');
const { prisma } = require('../dist/config/database.js');
const { orderService } = require('../dist/modules/orders/order.service.js');
const { custodyService } = require('../dist/modules/orders/custody.service.js');
const { searchService } = require('../dist/modules/search/search.service.js');
const { billingService } = require('../dist/modules/pricing/billing.service.js');
const { notificationService } = require('../dist/modules/notifications/notification.service.js');
const { sanitizeAuditValues } = require('../dist/middleware/audit.js');

const orderId = '8a4b7d9a-89e2-4f5f-9c75-cf3f37e1543e';
const itemId = '4f71e99f-b69a-4ff3-95f9-507f75f6242f';
const tenantId = 'f411a4d4-904a-4779-b697-5df8ba29a976';
const boxId = '9ff32a6e-818e-42ec-b35b-cd9c038758d7';
const userId = 'bc97d781-4c88-43ba-8090-01e7adfa0714';
const signatureData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4AWP8DwQMQMDEAAUAPfgEADYYS7QAAAAASUVORK5CYII=';

test('QR matches the exact loaned entity and preserves multiple matches for selection', () => {
  const boxCode = generateQrData('DOX', 'K-2026-000001');
  const folderCode = generateFolderQrData(itemId);
  const loans = [
    { id: 'box-loan-1', qrCode: boxCode },
    { id: 'box-loan-2', qrCode: boxCode },
    { id: 'folder-loan', qrCode: folderCode },
  ];
  assert.deepEqual(matchActiveLoansByQr(loans, boxCode), { kind: 'match', code: boxCode, loans: loans.slice(0, 2) });
  assert.deepEqual(matchActiveLoansByQr(loans, folderCode), { kind: 'match', code: folderCode, loans: [loans[2]] });
  assert.equal(matchActiveLoansByQr([loans[2]], boxCode).kind, 'missing');
  const badCode = `${boxCode.slice(0, -1)}${boxCode.endsWith('0') ? '1' : '0'}`;
  assert.equal(matchActiveLoansByQr(loans, badCode).kind, 'invalid');
});

function setup({ updatedCount = 1, remaining = 0, stillCheckedOut = 0, webhookEndpoints = [], item = { boxId } } = {}) {
  const calls = { updates: [], custody: [], completed: [], boxUpdates: [], boxLoanQueries: [], webhookDeliveries: [] };
  const order = {
    id: orderId,
    tenantId,
    orderType: 'checkout',
    status: 'delivered',
    orderNumber: 'Z-202610-00001',
    requestedBy: userId,
    items: [{ id: itemId, itemStatus: 'delivered', ...item }],
  };
  const tx = {
    $queryRaw: async () => [{ id: orderId }],
    orderItem: {
      updateMany: async (args) => { calls.updates.push(args); return { count: updatedCount }; },
      count: async (args) => {
        if (args.where.id) {
          calls.boxLoanQueries.push(args.where);
          return stillCheckedOut;
        }
        return remaining;
      },
    },
    custodyEvent: {
      create: async (args) => { calls.custody.push(args); },
    },
    order: {
      updateMany: async (args) => { calls.completed.push(args); return { count: 1 }; },
    },
    box: {
      updateMany: async (args) => { calls.boxUpdates.push(args); return { count: 1 }; },
    },
    webhookEndpoint: { findMany: async () => webhookEndpoints },
    webhookDelivery: { createMany: async (args) => { calls.webhookDeliveries.push(args); return { count: args.data.length }; } },
  };
  const mocks = [
    mock.method(orderService, 'getById', async () => order),
    mock.method(prisma, '$transaction', async (callback) => callback(tx)),
  ];
  return { calls, restore: () => mocks.reverse().forEach((entry) => entry.mock.restore()) };
}

test('return records custody once and closes an order after its last item', async () => {
  const { calls, restore } = setup();
  try {
    await orderService.returnLoanItem(orderId, itemId, tenantId, userId);
    assert.equal(calls.updates[0].where.itemStatus, 'delivered');
    assert.equal(calls.custody.length, 1);
    assert.equal(calls.custody[0].data.performedById, userId);
    assert.equal(calls.custody[0].data.fromUserId, undefined);
    assert.equal(calls.completed.length, 1);
    assert.equal(calls.boxUpdates.length, 1);
    assert.equal(calls.boxLoanQueries[0].boxId, boxId);
    assert.equal(calls.boxLoanQueries[0].OR, undefined);
  } finally { restore(); }
});

test('returning a folder records custody without changing its parent box status', async () => {
  const { calls, restore } = setup({ item: { folderId: itemId, folder: { box: { id: boxId } } } });
  try {
    await orderService.returnLoanItem(orderId, itemId, tenantId, userId);
    assert.equal(calls.custody.length, 1);
    assert.equal(calls.custody[0].data.folderId, itemId);
    assert.equal(calls.custody[0].data.boxId, undefined);
    assert.equal(calls.completed.length, 1);
    assert.equal(calls.boxLoanQueries.length, 0);
    assert.equal(calls.boxUpdates.length, 0);
  } finally { restore(); }
});

test('returning the last loan item queues a completed status webhook', async () => {
  const { calls, restore } = setup({ webhookEndpoints: [{ id: 'endpoint-a' }] });
  try {
    await orderService.returnLoanItem(orderId, itemId, tenantId, userId);
    assert.equal(calls.webhookDeliveries.length, 1);
    const payload = JSON.parse(calls.webhookDeliveries[0].data[0].payloadText);
    assert.equal(payload.data.previousStatus, 'delivered');
    assert.equal(payload.data.status, 'completed');
  } finally { restore(); }
});

test('a second return cannot create a duplicate custody event', async () => {
  const { calls, restore } = setup({ updatedCount: 0 });
  try {
    await assert.rejects(orderService.returnLoanItem(orderId, itemId, tenantId, userId), /już zwrócona/);
    assert.equal(calls.custody.length, 0);
    assert.equal(calls.completed.length, 0);
    assert.equal(calls.boxUpdates.length, 0);
  } finally { restore(); }
});

test('return keeps the order and box checked out while other items remain', async () => {
  const { calls, restore } = setup({ remaining: 1, stillCheckedOut: 1 });
  try {
    await orderService.returnLoanItem(orderId, itemId, tenantId, userId);
    assert.equal(calls.completed.length, 0);
    assert.equal(calls.boxUpdates.length, 0);
  } finally { restore(); }
});

test('delivering or returning a folder leaves its parent box status unchanged', async () => {
  for (const { orderType, item, expectedBoxStatus } of [
    { orderType: 'checkout', item: { id: itemId, itemStatus: 'picked', folderId: itemId, folder: { box: { id: boxId } } }, expectedBoxStatus: null },
    { orderType: 'return_order', item: { id: itemId, itemStatus: 'pending', folderId: itemId, folder: { box: { id: boxId } } }, expectedBoxStatus: null },
    { orderType: 'checkout', item: { id: itemId, itemStatus: 'picked', documentId: itemId, document: { box: { id: boxId } } }, expectedBoxStatus: null },
    { orderType: 'checkout', item: { id: itemId, itemStatus: 'picked', hrFolderId: itemId, hrFolder: { box: { id: boxId } } }, expectedBoxStatus: null },
    { orderType: 'checkout', item: { id: itemId, itemStatus: 'picked', boxId }, expectedBoxStatus: 'checked_out' },
    { orderType: 'return_order', item: { id: itemId, itemStatus: 'pending', boxId }, expectedBoxStatus: 'active' },
  ]) {
    const calls = { custody: [], boxUpdates: [], proofs: [], checks: [] };
    const order = {
      id: orderId, tenantId, orderType, status: 'ready',
      orderNumber: 'Z-202610-00001', requestedBy: userId, items: [item],
    };
    const tx = {
      order: { update: async () => order },
      orderItem: { updateMany: async () => ({ count: 1 }) },
      custodyEvent: { createMany: async ({ data }) => { calls.custody.push(...data); } },
      orderHandoverProof: { create: async ({ data }) => { calls.proofs.push(data); } },
      orderHandoverBox: { createMany: async ({ data }) => { calls.checks.push(...data); } },
      box: { updateMany: async (args) => { calls.boxUpdates.push(args); return { count: 1 }; } },
      webhookEndpoint: { findMany: async () => [] },
    };
    const mocks = [
      mock.method(orderService, 'getById', async () => order),
      mock.method(prisma, '$transaction', async (callback) => callback(tx)),
      mock.method(billingService, 'buildOrderDeliveryEvents', async () => []),
      mock.method(notificationService, 'notifyTenantUsers', async () => undefined),
    ];
    try {
      const proof = orderType === 'checkout'
        ? item.boxId
          ? { recipientName: 'Anna Kowalska', signatureData, boxChecks: [{ boxId, condition: 'damaged', sealNumber: 'P-12', conditionNote: 'Rozerwany narożnik' }] }
          : { recipientName: 'Anna Kowalska', signatureData, latitude: 50.1, longitude: 18.6, accuracyMeters: 12, boxChecks: [] }
        : undefined;
      await orderService.deliver(orderId, tenantId, userId, proof);
      assert.equal(calls.custody.length, 1);
      const targetField = item.documentId ? 'documentId' : item.folderId ? 'folderId' : item.hrFolderId ? 'hrFolderId' : 'boxId';
      assert.equal(calls.custody[0][targetField], item[targetField]);
      assert.equal(['boxId', 'folderId', 'documentId', 'hrFolderId'].filter((field) => calls.custody[0][field]).length, 1);
      assert.equal(calls.custody[0].performedById, userId);
      assert.equal(calls.custody[0].recipientName, proof?.recipientName || null);
      assert.equal(calls.custody[0].toUserId, undefined);
      assert.equal(calls.proofs.length, proof ? 1 : 0);
      assert.equal(calls.checks.length, proof && item.boxId ? 1 : 0);
      if (calls.checks.length) {
        assert.equal(calls.checks[0].boxId, boxId);
        assert.equal(calls.checks[0].condition, 'damaged');
        assert.equal(calls.checks[0].sealNumber, 'P-12');
      }
      if (proof) {
        assert.equal(calls.proofs[0].orderId, orderId);
        assert.equal(calls.proofs[0].recordedById, userId);
        assert.equal(calls.proofs[0].recipientName, proof.recipientName);
        assert.equal(calls.proofs[0].signatureData, signatureData);
        assert.equal(calls.proofs[0].latitude, proof.latitude);
        assert.ok(calls.proofs[0].recordedAt instanceof Date);
      }
      assert.equal(calls.boxUpdates.length, expectedBoxStatus ? 1 : 0);
      if (expectedBoxStatus) assert.equal(calls.boxUpdates[0].data.status, expectedBoxStatus);
    } finally { mocks.reverse().forEach((entry) => entry.mock.restore()); }
  }
});

test('delivering two folders from one box records two distinct folder handovers', async () => {
  const folderTwoId = 'fb29721c-f3c3-4b63-b82b-62aff03ec269';
  const calls = { custody: [], boxUpdates: [] };
  const order = {
    id: orderId, tenantId, orderType: 'checkout', status: 'ready', requestedBy: userId,
    items: [
      { id: itemId, folderId: itemId, folder: { box: { id: boxId } }, itemStatus: 'picked' },
      { id: folderTwoId, folderId: folderTwoId, folder: { box: { id: boxId } }, itemStatus: 'picked' },
    ],
  };
  const tx = {
    order: { update: async () => order },
    orderItem: { updateMany: async () => ({ count: 2 }) },
    custodyEvent: { createMany: async ({ data }) => { calls.custody.push(...data); } },
    box: { updateMany: async (args) => { calls.boxUpdates.push(args); } },
    webhookEndpoint: { findMany: async () => [] },
  };
  const mocks = [
    mock.method(orderService, 'getById', async () => order),
    mock.method(prisma, '$transaction', async (callback) => callback(tx)),
    mock.method(billingService, 'buildOrderDeliveryEvents', async () => []),
    mock.method(notificationService, 'notifyTenantUsers', async () => undefined),
  ];
  try {
    await orderService.deliver(orderId, tenantId, userId);
    assert.deepEqual(calls.custody.map((event) => event.folderId), [itemId, folderTwoId]);
    assert.ok(calls.custody.every((event) => event.boxId === undefined));
    assert.equal(calls.boxUpdates.length, 0);
  } finally { mocks.reverse().forEach((entry) => entry.mock.restore()); }
});

test('order custody history filters by department and does not return signature bytes', async () => {
  const originals = { order: prisma.order.findFirst, events: prisma.custodyEvent.findMany };
  let captured;
  prisma.order.findFirst = async ({ where }) => where.id === orderId && where.tenantId === tenantId ? { id: orderId } : null;
  prisma.custodyEvent.findMany = async (query) => { captured = query; return []; };
  try {
    await custodyService.getByOrder(orderId, tenantId, 'Księgowość');
    assert.equal(captured.where.orderId, orderId);
    assert.equal(captured.where.OR[1].folder.box.department.equals, 'Księgowość');
    assert.equal(captured.select.folderId, true);
    assert.equal(captured.select.documentId, true);
    assert.equal(captured.select.signatureData, undefined);
  } finally {
    prisma.order.findFirst = originals.order;
    prisma.custodyEvent.findMany = originals.events;
  }
});

test('asset custody history requires tenant and department access and excludes signatures', async () => {
  let folderVisible = false;
  let captured;
  const originals = { folder: prisma.folder.findFirst, events: prisma.custodyEvent.findMany, count: prisma.custodyEvent.count };
  prisma.folder.findFirst = async ({ where }) => {
    assert.equal(where.tenantId, tenantId);
    assert.equal(where.box.is.department.equals, 'Księgowość');
    return folderVisible ? { id: itemId } : null;
  };
  prisma.custodyEvent.findMany = async (query) => { captured = query; return []; };
  prisma.custodyEvent.count = async () => 0;
  try {
    await assert.rejects(custodyService.getByTarget('folder', itemId, tenantId, 'Księgowość', 0, 30), { statusCode: 404 });
    assert.equal(captured, undefined);
    folderVisible = true;
    const result = await custodyService.getByTarget('folder', itemId, tenantId, 'Księgowość', 30, 30);
    assert.deepEqual(result, { data: [], total: 0 });
    assert.equal(captured.where.folderId, itemId);
    assert.equal(captured.skip, 30);
    assert.equal(captured.take, 30);
    assert.equal(captured.select.signatureData, undefined);
    assert.equal(captured.select.orderNumberSnapshot, true);
  } finally {
    prisma.folder.findFirst = originals.folder;
    prisma.custodyEvent.findMany = originals.events;
    prisma.custodyEvent.count = originals.count;
  }
});

test('document custody history accepts a document inside a department folder', async () => {
  let captured;
  const originals = { document: prisma.document.findFirst, events: prisma.custodyEvent.findMany, count: prisma.custodyEvent.count };
  prisma.document.findFirst = async ({ where }) => {
    assert.equal(where.tenantId, tenantId);
    assert.equal(where.OR[1].folder.is.box.is.department.equals, 'Księgowość');
    return { id: itemId };
  };
  prisma.custodyEvent.findMany = async (query) => { captured = query; return []; };
  prisma.custodyEvent.count = async () => 0;
  try {
    await custodyService.getByTarget('document', itemId, tenantId, 'Księgowość', 0, 30);
    assert.equal(captured.where.documentId, itemId);
  } finally {
    prisma.document.findFirst = originals.document;
    prisma.custodyEvent.findMany = originals.events;
    prisma.custodyEvent.count = originals.count;
  }
});

test('deleting a closed order preserves its number on custody events', async () => {
  let updated;
  const originals = {
    order: prisma.order.findFirst, scanCount: prisma.orderScanFile.count,
    photoCount: prisma.orderHandoverPhoto.count, custody: prisma.custodyEvent.updateMany,
    deleteOrder: prisma.order.delete,
  };
  prisma.order.findFirst = async () => ({ id: orderId, status: 'completed', orderNumber: 'Z-202610-00001' });
  prisma.orderScanFile.count = async () => 0;
  prisma.orderHandoverPhoto.count = async () => 0;
  prisma.custodyEvent.updateMany = async (args) => { updated = args; return { count: 1 }; };
  prisma.order.delete = async () => ({ id: orderId });
  const transaction = mock.method(prisma, '$transaction', async (operations) => Promise.all(operations));
  try {
    assert.deepEqual(await orderService.delete(orderId, tenantId), { deleted: true });
    assert.equal(updated.where.orderId, orderId);
    assert.deepEqual(updated.data, { orderId: null, orderNumberSnapshot: 'Z-202610-00001' });
  } finally {
    transaction.mock.restore();
    prisma.order.findFirst = originals.order;
    prisma.orderScanFile.count = originals.scanCount;
    prisma.orderHandoverPhoto.count = originals.photoCount;
    prisma.custodyEvent.updateMany = originals.custody;
    prisma.order.delete = originals.deleteOrder;
  }
});

test('search does not expose personnel documents without HR permission', async () => {
  let hrQueries = 0;
  const mocks = [
    mock.method(searchService, 'searchDocuments', async () => []),
    mock.method(searchService, 'searchAttachments', async () => []),
    mock.method(searchService, 'searchHRDocuments', async () => { hrQueries++; return []; }),
  ];
  try {
    await searchService.search(tenantId, 'test', { types: ['document'], canViewHr: false }, 'Księgowość');
    assert.equal(hrQueries, 0);
    await searchService.search(tenantId, 'test', { types: ['document'], canViewHr: true });
    assert.equal(hrQueries, 1);
  } finally { mocks.reverse().forEach((entry) => entry.mock.restore()); }
});

test('manual custody requires a direct order box and a tenant recipient', async () => {
  let directItem = null;
  let recipient = null;
  const originals = {
    box: prisma.box.findFirst, order: prisma.order.findFirst, item: prisma.orderItem.findFirst,
    user: prisma.user.findFirst, event: prisma.custodyEvent.create,
  };
  prisma.box.findFirst = async () => ({ id: boxId });
  prisma.order.findFirst = async () => ({ id: orderId });
  prisma.orderItem.findFirst = async ({ where }) => { assert.equal(where.boxId, boxId); return directItem; };
  prisma.user.findFirst = async ({ where }) => { assert.equal(where.OR[0].tenantId, tenantId); return recipient; };
  prisma.custodyEvent.create = async ({ data }) => data;
  try {
    const data = { orderId, boxId, eventType: 'handover', fromUserId: userId, toUserId: userId };
    await assert.rejects(custodyService.create(data, tenantId), { statusCode: 400 });
    directItem = { id: itemId };
    await assert.rejects(custodyService.create(data, tenantId), { statusCode: 400 });
    recipient = { id: userId };
    const created = await custodyService.create(data, tenantId);
    assert.equal(created.boxId, boxId);
    assert.equal(created.performedById, userId);
  } finally {
    prisma.box.findFirst = originals.box;
    prisma.order.findFirst = originals.order;
    prisma.orderItem.findFirst = originals.item;
    prisma.user.findFirst = originals.user;
    prisma.custodyEvent.create = originals.event;
  }
});

test('invalid signature cannot deliver an order', async () => {
  const order = { id: orderId, tenantId, orderType: 'checkout', status: 'ready', items: [] };
  const getById = mock.method(orderService, 'getById', async () => order);
  try {
    await assert.rejects(orderService.deliver(orderId, tenantId, userId, {
      recipientName: 'Anna Kowalska', signatureData: 'data:image/png;base64,bm90IGEgcG5n',
    }), /Podpis/);
  } finally { getById.mock.restore(); }
});

test('handover cannot assign a condition to a box outside the order', async () => {
  const order = { id: orderId, tenantId, orderType: 'checkout', status: 'ready', items: [{ boxId }] };
  const getById = mock.method(orderService, 'getById', async () => order);
  try {
    await assert.rejects(orderService.deliver(orderId, tenantId, userId, {
      recipientName: 'Anna Kowalska', boxChecks: [{ boxId: itemId, condition: 'intact' }],
    }), /Potwierdź stan każdego kartonu/);
  } finally { getById.mock.restore(); }
});

test('audit records the handover without copying the signature image', () => {
  const values = sanitizeAuditValues({ handoverProof: { recipientName: 'Anna Kowalska', signatureData } });
  assert.equal(values.handoverProof.recipientName, 'Anna Kowalska');
  assert.equal(values.handoverProof.signatureData, '[redacted]');
});
