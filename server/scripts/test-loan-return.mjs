import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateQrData, generateFolderQrData } = require('../../shared/src/utils/qr.ts');
const { matchActiveLoansByQr } = require('../../client/src/utils/loanReturn.ts');
const { prisma } = require('../dist/config/database.js');
const { orderService } = require('../dist/modules/orders/order.service.js');
const { billingService } = require('../dist/modules/pricing/billing.service.js');
const { notificationService } = require('../dist/modules/notifications/notification.service.js');

const orderId = '8a4b7d9a-89e2-4f5f-9c75-cf3f37e1543e';
const itemId = '4f71e99f-b69a-4ff3-95f9-507f75f6242f';
const tenantId = 'f411a4d4-904a-4779-b697-5df8ba29a976';
const boxId = '9ff32a6e-818e-42ec-b35b-cd9c038758d7';
const userId = 'bc97d781-4c88-43ba-8090-01e7adfa0714';

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
    { orderType: 'checkout', item: { id: itemId, itemStatus: 'picked', boxId }, expectedBoxStatus: 'checked_out' },
    { orderType: 'return_order', item: { id: itemId, itemStatus: 'pending', boxId }, expectedBoxStatus: 'active' },
  ]) {
    const calls = { custody: [], boxUpdates: [] };
    const order = {
      id: orderId, tenantId, orderType, status: 'ready',
      orderNumber: 'Z-202610-00001', requestedBy: userId, items: [item],
    };
    const tx = {
      order: { update: async () => order },
      orderItem: { updateMany: async () => ({ count: 1 }) },
      custodyEvent: { createMany: async ({ data }) => { calls.custody.push(...data); } },
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
      await orderService.deliver(orderId, tenantId, userId);
      assert.equal(calls.custody.length, 1);
      assert.equal(calls.custody[0].boxId, boxId);
      assert.equal(calls.boxUpdates.length, expectedBoxStatus ? 1 : 0);
      if (expectedBoxStatus) assert.equal(calls.boxUpdates[0].data.status, expectedBoxStatus);
    } finally { mocks.reverse().forEach((entry) => entry.mock.restore()); }
  }
});
