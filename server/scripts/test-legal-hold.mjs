import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prisma } = require('../dist/config/database.js');
const { BoxService } = require('../dist/modules/boxes/box.service.js');
const { RetentionService } = require('../dist/modules/retention/retention.service.js');
const { OrderService } = require('../dist/modules/orders/order.service.js');
const { notificationService } = require('../dist/modules/notifications/notification.service.js');
const { boxLegalHoldSchema } = require('../../shared/src/validators/box.schema.ts');

const tenantId = '1f11541e-00c7-4bbd-8059-bbb7d189a013';
const boxId = 'a07ca020-f00e-485c-9d01-f9ed697e2f40';
const secondBoxId = '14a504c7-4864-4027-a02c-685201fb38f8';
const locationId = '08675a3a-8a69-477a-82f1-b52d74b97bde';

test('legal hold requires a meaningful reason when enabled', () => {
  assert.equal(boxLegalHoldSchema.safeParse({ hold: true, reason: 'Spór sądowy' }).success, true);
  assert.equal(boxLegalHoldSchema.safeParse({ hold: true, reason: 'x' }).success, false);
  assert.equal(boxLegalHoldSchema.safeParse({ hold: false }).success, true);
});

test('holding a box cancels pending disposal in the same transaction', async () => {
  const service = new BoxService();
  const updates = [];
  const mocks = [
    mock.method(service, 'getById', async () => ({ id: boxId, status: 'pending_disposal' })),
    mock.method(prisma, '$transaction', async (callback) => callback({
      box: { updateMany: async (args) => { updates.push(args); return { count: 1 }; } },
    })),
  ];
  try {
    await service.setLegalHold(boxId, tenantId, true, 'Spór sądowy');
    assert.equal(updates.length, 2);
    assert.equal(updates[0].where.tenantId, tenantId);
    assert.equal(updates[0].data.legalHold, true);
    assert.equal(updates[0].data.legalHoldReason, 'Spór sądowy');
    assert.equal(updates[1].where.status, 'pending_disposal');
    assert.equal(updates[1].data.status, 'active');
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
  }
});

test('status change cannot dispose a held box', async () => {
  const service = new BoxService();
  const originalUpdateMany = prisma.box.updateMany;
  prisma.box.updateMany = async ({ where }) => {
    assert.equal(where.legalHold, false);
    assert.deepEqual(where.hrFolders, { none: { litigationHold: true } });
    return { count: 0 };
  };
  const mocks = [
    mock.method(service, 'getById', async () => ({ id: boxId, status: 'active' })),
  ];
  try {
    await assert.rejects(service.changeStatus(boxId, tenantId, 'disposed'), { statusCode: 409 });
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
    prisma.box.updateMany = originalUpdateMany;
  }
});

test('approving disposal fails without changing location counts when a box is held', async () => {
  const service = new RetentionService();
  let updated = false;
  let locationChanged = false;
  const mocks = [
    mock.method(prisma, '$transaction', async (callback) => callback({
      box: {
        findMany: async ({ where }) => {
          assert.equal(where.legalHold, false);
          assert.deepEqual(where.hrFolders, { none: { litigationHold: true } });
          return [{ id: boxId, locationId }];
        },
        updateMany: async () => { updated = true; return { count: 2 }; },
      },
      location: { update: async () => { locationChanged = true; } },
    })),
    mock.method(notificationService, 'notifyTenantUsers', async () => { throw new Error('Unexpected notification'); }),
  ];
  try {
    await assert.rejects(service.approveDisposal(tenantId, [boxId, secondBoxId]), { statusCode: 409 });
    assert.equal(updated, false);
    assert.equal(locationChanged, false);
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
  }
});

test('starting disposal rejects the whole selection when one box is held', async () => {
  const service = new RetentionService();
  let notified = false;
  const mocks = [
    mock.method(prisma, '$transaction', async (callback) => callback({
      box: { updateMany: async ({ where }) => {
        assert.equal(where.legalHold, false);
        assert.deepEqual(where.id.in, [boxId, secondBoxId]);
        return { count: 1 };
      } },
    })),
    mock.method(notificationService, 'notifyTenantUsers', async () => { notified = true; }),
  ];
  try {
    await assert.rejects(service.initiateDisposal(tenantId, [boxId, secondBoxId]), { statusCode: 409 });
    assert.equal(notified, false);
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
  }
});

test('approving eligible boxes decrements each location only for disposed boxes', async () => {
  const service = new RetentionService();
  const locations = [];
  const mocks = [
    mock.method(prisma, '$transaction', async (callback) => callback({
      box: {
        findMany: async () => [{ id: boxId, locationId }, { id: secondBoxId, locationId }],
        updateMany: async ({ where }) => {
          assert.equal(where.legalHold, false);
          return { count: 2 };
        },
      },
      location: { update: async (args) => { locations.push(args); } },
    })),
    mock.method(notificationService, 'notifyTenantUsers', async () => {}),
  ];
  try {
    const result = await service.approveDisposal(tenantId, [boxId, secondBoxId]);
    assert.equal(result.count, 2);
    assert.deepEqual(locations, [{ where: { id: locationId }, data: { currentCount: { decrement: 2 } } }]);
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
  }
});

test('disposal orders resolve boxes through transfer list folders', async () => {
  const service = new OrderService();
  const originalCount = prisma.box.count;
  prisma.box.count = async ({ where }) => {
    assert.deepEqual(where.id.in, [boxId]);
    assert.equal(where.tenantId, tenantId);
    return 1;
  };
  try {
    await assert.rejects(service.assertDisposalNotHeld({
      items: [{ transferListItem: { folder: { box: { id: boxId } } } }],
    }, tenantId), { statusCode: 409 });
  } finally {
    prisma.box.count = originalCount;
  }
});
