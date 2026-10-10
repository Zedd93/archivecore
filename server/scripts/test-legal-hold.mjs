import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prisma } = require('../dist/config/database.js');
const { BoxService } = require('../dist/modules/boxes/box.service.js');
const { RetentionService } = require('../dist/modules/retention/retention.service.js');
const { OrderService } = require('../dist/modules/orders/order.service.js');
const { notificationService } = require('../dist/modules/notifications/notification.service.js');
const { parseDisposalConfirmation, buildDisposalConfirmationPdf } = require('../dist/modules/retention/disposal-confirmation.js');
const { boxLegalHoldSchema, changeBoxStatusSchema, bulkBoxStatusSchema } = require('../../shared/src/validators/box.schema.ts');
const { approveDisposalSchema, rejectDisposalSchema, completeDisposalSchema } = require('../../shared/src/validators/retention.schema.ts');

const tenantId = '1f11541e-00c7-4bbd-8059-bbb7d189a013';
const boxId = 'a07ca020-f00e-485c-9d01-f9ed697e2f40';
const secondBoxId = '14a504c7-4864-4027-a02c-685201fb38f8';
const locationId = '08675a3a-8a69-477a-82f1-b52d74b97bde';
const proposerId = '0ab09ae1-75cb-4e65-9342-8b613196271f';
const approver = { userId: 'c79989bc-eaeb-4a24-824b-5aef5453b90d', tenantId, roles: ['TL'], permissions: ['disposal.approve'] };

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
    assert.deepEqual(updates[1].where.status.in, ['pending_disposal', 'approved_disposal']);
    assert.equal(updates[1].data.status, 'active');
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
  }
});

test('holding an approved box also withdraws it from disposal', async () => {
  const service = new BoxService();
  const updates = [];
  const mocks = [
    mock.method(service, 'getById', async () => ({ id: boxId, status: 'approved_disposal' })),
    mock.method(prisma, '$transaction', async (callback) => callback({
      box: { updateMany: async (args) => { updates.push(args); return { count: 1 }; } },
    })),
  ];
  try {
    await service.setLegalHold(boxId, tenantId, true, 'Spór sądowy');
    assert.equal(updates[1].data.status, 'active');
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
  }
});

test('ordinary box status changes cannot bypass disposal workflow', async () => {
  const service = new BoxService();
  assert.equal(changeBoxStatusSchema.safeParse({ status: 'disposed' }).success, false);
  assert.equal(changeBoxStatusSchema.safeParse({ status: 'approved_disposal' }).success, false);
  assert.equal(bulkBoxStatusSchema.safeParse({ ids: [boxId], status: 'pending_disposal' }).success, false);
  await assert.rejects(service.changeStatus(boxId, tenantId, 'disposed'), { statusCode: 409 });
  await assert.rejects(service.changeStatus(boxId, tenantId, 'approved_disposal'), { statusCode: 409 });
  await assert.rejects(service.bulkChangeStatus([boxId], tenantId, 'pending_disposal'), { statusCode: 409 });
});

test('bulk status updates cannot revive a disposed box', async () => {
  const service = new BoxService();
  const mocks = [mock.method(prisma, '$transaction', async (callback) => callback({
    box: { updateMany: async ({ where }) => {
      assert.deepEqual(where.status, { notIn: ['pending_disposal', 'approved_disposal', 'disposed'] });
      return { count: 0 };
    } },
  }))];
  try {
    await assert.rejects(service.bulkChangeStatus([boxId], tenantId, 'active'), { statusCode: 409 });
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
  }
});

test('bulk deletion preserves boxes already submitted for disposal', async () => {
  const service = new BoxService();
  const originalFindMany = prisma.box.findMany;
  prisma.box.findMany = async () => [{ id: boxId, status: 'pending_disposal', legalHold: false }];
  try {
    await assert.rejects(service.bulkDelete([boxId], tenantId), { statusCode: 409 });
  } finally {
    prisma.box.findMany = originalFindMany;
  }
});

test('disposal candidates require a live policy and exclude permanent, review and personnel records', () => {
  const where = new RetentionService().disposalEligibility(tenantId);
  assert.equal(where.tenantId, tenantId);
  assert.equal(where.legalHold, false);
  assert.deepEqual(where.hrFolders, { none: {} });
  assert.equal(where.retentionPolicy.is.isPermanent, false);
  assert.equal(where.retentionPolicy.is.isActive, true);
  assert.deepEqual(where.retentionPolicy.is.AND[0].OR, [{ tenantId: null }, { tenantId }]);
  assert.equal(where.retentionPolicy.is.AND[1].OR[1].NOT.OR[0].archivalCategory.startsWith, 'A');
  assert.equal(where.retentionPolicy.is.AND[1].OR[1].NOT.OR[1].archivalCategory.startsWith, 'BE');
  assert.equal(where.transferListItems.none.OR[0].categoryCode.startsWith, 'A');
  assert.equal(where.transferListItems.none.OR[1].categoryCode.startsWith, 'BE');
  assert.ok(where.transferListItems.none.OR[2].disposalOrTransferDate.gt instanceof Date);
});

test('review list separates due and upcoming dates and paginates each tenant', async () => {
  const service = new RetentionService();
  const originalFindMany = prisma.box.findMany;
  const originalCount = prisma.box.count;
  const queries = [];
  prisma.box.findMany = async (args) => { queries.push(args); return [{ id: boxId }]; };
  prisma.box.count = async ({ where }) => { assert.equal(where.tenantId, tenantId); return 34; };
  try {
    const due = await service.getBoxesForReview(tenantId, 90, 'due', 2, 25);
    const upcoming = await service.getBoxesForReview(tenantId, 90, 'upcoming', 1, 25);
    assert.equal(due.total, 34);
    assert.equal(due.page, 2);
    assert.equal(queries[0].skip, 25);
    assert.ok(queries[0].where.retentionDate.lte instanceof Date);
    assert.equal(queries[0].where.retentionDate.gt, undefined);
    assert.ok(queries[1].where.retentionDate.gt instanceof Date);
    assert.ok(queries[1].where.retentionDate.lte instanceof Date);
  } finally {
    prisma.box.findMany = originalFindMany;
    prisma.box.count = originalCount;
  }
});

test('pending disposal list remains tenant-scoped and paginated', async () => {
  const service = new RetentionService();
  const originalFindMany = prisma.box.findMany;
  const originalCount = prisma.box.count;
  prisma.box.findMany = async ({ where, skip, take }) => {
    assert.equal(where.tenantId, tenantId);
    assert.equal(where.status, 'pending_disposal');
    assert.equal(skip, 25);
    assert.equal(take, 25);
    return [{ id: boxId }];
  };
  prisma.box.count = async ({ where }) => {
    assert.equal(where.tenantId, tenantId);
    return 26;
  };
  try {
    const result = await service.getPendingDisposal(tenantId, 2, 25);
    assert.equal(result.total, 26);
    assert.equal(result.data[0].id, boxId);
  } finally {
    prisma.box.findMany = originalFindMany;
    prisma.box.count = originalCount;
  }
});

test('approved disposal list remains tenant-scoped and paginated', async () => {
  const service = new RetentionService();
  const originalFindMany = prisma.box.findMany;
  const originalCount = prisma.box.count;
  prisma.box.findMany = async ({ where, skip, take }) => {
    assert.equal(where.tenantId, tenantId);
    assert.equal(where.status, 'approved_disposal');
    assert.equal(skip, 25);
    assert.equal(take, 25);
    return [{ id: boxId }];
  };
  prisma.box.count = async ({ where }) => {
    assert.equal(where.tenantId, tenantId);
    return 26;
  };
  try {
    const result = await service.getApprovedDisposal(tenantId, 2, 25);
    assert.equal(result.total, 26);
  } finally {
    prisma.box.findMany = originalFindMany;
    prisma.box.count = originalCount;
  }
});

test('client approval fails without changing location counts when a box is held', async () => {
  const service = new RetentionService();
  let updated = false;
  let locationChanged = false;
  const mocks = [
    mock.method(prisma, '$transaction', async (callback) => callback({
      box: {
        updateMany: async ({ where }) => {
          assert.equal(where.legalHold, false);
          assert.deepEqual(where.hrFolders, { none: {} });
          assert.ok(where.retentionDate.lte instanceof Date);
          updated = true;
          return { count: 1 };
        },
      },
      auditLog: { findMany: async () => [] },
      location: { update: async () => { locationChanged = true; } },
    })),
    mock.method(notificationService, 'notifyTenantUsers', async () => { throw new Error('Unexpected notification'); }),
  ];
  try {
    await assert.rejects(service.approveDisposal(tenantId, [boxId, secondBoxId], approver), { statusCode: 409 });
    assert.equal(updated, true);
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
        assert.deepEqual(where.hrFolders, { none: {} });
        assert.ok(where.retentionDate.lte instanceof Date);
        assert.deepEqual(where.id.in, [boxId, secondBoxId]);
        return { count: 1 };
      } },
    })),
    mock.method(notificationService, 'notifyTenantUsers', async () => { notified = true; }),
  ];
  try {
    await assert.rejects(service.initiateDisposal(tenantId, [boxId, secondBoxId], proposerId), { statusCode: 409 });
    assert.equal(notified, false);
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
  }
});

test('starting disposal submits only due, eligible boxes and notifies reviewers', async () => {
  const service = new RetentionService();
  let notified = false;
  const audits = [];
  const mocks = [
    mock.method(prisma, '$transaction', async (callback) => callback({
      box: { updateMany: async ({ where, data }) => {
        assert.equal(where.status, 'active');
        assert.ok(where.retentionDate.lte instanceof Date);
        assert.equal(where.retentionPolicy.is.isPermanent, false);
        assert.equal(data.status, 'pending_disposal');
        assert.equal(data.notes, undefined);
        return { count: 1 };
      } },
      auditLog: { createMany: async ({ data }) => { audits.push(...data); } },
    })),
    mock.method(notificationService, 'notifyTenantUsers', async ({ tenantId: recipientTenant, includeGlobalUsers }) => {
      assert.equal(recipientTenant, tenantId);
      assert.equal(includeGlobalUsers, false);
      notified = true;
    }),
  ];
  try {
    const result = await service.initiateDisposal(tenantId, [boxId, boxId], proposerId);
    assert.deepEqual(result.boxIds, [boxId]);
    assert.equal(result.count, 1);
    assert.equal(notified, true);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].userId, proposerId);
    assert.equal(audits[0].action, 'disposal.proposed');
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
  }
});

test('client approval is tenant-scoped and cannot approve the actor own proposal', async () => {
  const service = new RetentionService();
  await assert.rejects(service.approveDisposal(tenantId, [boxId], { ...approver, tenantId: secondBoxId }), { statusCode: 403 });
  const mocks = [mock.method(prisma, '$transaction', async (callback) => callback({
    auditLog: { findMany: async () => [{ entityId: boxId, userId: approver.userId }] },
    box: { updateMany: async () => { throw new Error('Should not update'); } },
  }))];
  try {
    await assert.rejects(service.approveDisposal(tenantId, [boxId], approver), { statusCode: 409 });
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
  }
});

test('client approval records a decision without changing occupancy', async () => {
  const service = new RetentionService();
  const locations = [];
  const audits = [];
  const mocks = [
    mock.method(prisma, '$transaction', async (callback) => callback({
      box: {
        updateMany: async ({ where, data }) => {
          assert.equal(where.legalHold, false);
          assert.equal(where.status, 'pending_disposal');
          assert.equal(data.status, 'approved_disposal');
          return { count: 2 };
        },
      },
      auditLog: {
        findMany: async () => [{ entityId: boxId, userId: proposerId }, { entityId: secondBoxId, userId: proposerId }],
        createMany: async ({ data }) => { audits.push(...data); },
      },
      location: { update: async (args) => { locations.push(args); } },
    })),
    mock.method(notificationService, 'notifyTenantUsers', async () => {}),
  ];
  try {
    const result = await service.approveDisposal(tenantId, [boxId, secondBoxId], approver);
    assert.equal(result.count, 2);
    assert.deepEqual(locations, []);
    assert.equal(audits.length, 2);
    assert.equal(audits[0].action, 'disposal.client_approved');
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
  }
});

test('rejected proposal restores active status and records reason', async () => {
  const service = new RetentionService();
  const audits = [];
  const mocks = [
    mock.method(prisma, '$transaction', async (callback) => callback({
      box: { updateMany: async ({ where, data }) => {
        assert.equal(where.tenantId, tenantId);
        assert.equal(where.status, 'pending_disposal');
        assert.equal(data.status, 'active');
        return { count: 1 };
      } },
      auditLog: { createMany: async ({ data }) => { audits.push(...data); } },
    })),
    mock.method(notificationService, 'notifyTenantUsers', async () => {}),
  ];
  try {
    await service.rejectDisposal(tenantId, [boxId], approver, 'Błędna kategoria');
    assert.equal(audits[0].newValues.reason, 'Błędna kategoria');
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
  }
});

test('only completed disposal changes folders and warehouse occupancy', async () => {
  const service = new RetentionService();
  const locations = [];
  const folders = [];
  const audits = [];
  const mocks = [
    mock.method(prisma, '$transaction', async (callback) => callback({
      box: {
        findMany: async ({ where }) => {
          assert.equal(where.status, 'approved_disposal');
          return [
            { id: boxId, locationId, boxNumber: 'K-1', title: 'Teczki Łódź', location: { fullPath: 'Magazyn / Regał 1' } },
            { id: secondBoxId, locationId, boxNumber: 'K-2', title: 'Akta', location: { fullPath: 'Magazyn / Regał 1' } },
          ];
        },
        updateMany: async ({ data }) => { assert.equal(data.status, 'disposed'); assert.equal(data.locationId, null); return { count: 2 }; },
        count: async ({ where }) => { assert.equal(where.locationId, locationId); return 0; },
      },
      folder: { updateMany: async (args) => { folders.push(args); } },
      location: { update: async (args) => { locations.push(args); } },
      auditLog: { createMany: async ({ data }) => { audits.push(...data); } },
    })),
    mock.method(notificationService, 'notifyTenantUsers', async () => {}),
  ];
  try {
    const result = await service.completeDisposal(tenantId, [boxId, secondBoxId], proposerId, 'PROT-2026-1');
    assert.equal(result.count, 2);
    assert.deepEqual(locations, [{ where: { id: locationId }, data: { currentCount: 0 } }]);
    assert.equal(folders[0].data.status, 'disposed');
    assert.equal(audits[0].newValues.protocolReference, 'PROT-2026-1');
    assert.equal(audits[0].oldValues.locationId, locationId);
    assert.equal(audits[0].newValues.batchId, result.batchId);
    assert.equal(audits[2].entityType, 'disposal_batch');
    assert.equal(audits[2].entityId, result.batchId);
    assert.equal(audits[2].newValues.protocolReference, 'PROT-2026-1');
    assert.deepEqual(audits[2].newValues.boxes.map((box) => box.boxNumber), ['K-1', 'K-2']);
    assert.equal(audits[2].newValues.boxes[0].location, 'Magazyn / Regał 1');
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
  }
});

test('completed disposal history and confirmation are scoped to the selected tenant', async () => {
  const service = new RetentionService();
  const calls = [];
  const record = {
    entityId: boxId,
    createdAt: new Date('2026-10-10T10:00:00Z'),
    newValues: { protocolReference: 'PROT-2026-1', boxes: [{ id: boxId, boxNumber: 'K-1', title: 'Teczki Łódź', location: 'Magazyn 1' }] },
    tenant: { name: 'Spółdzielnia Łódź' },
    user: { firstName: 'Anna', lastName: 'Nowak' },
  };
  const auditLog = prisma.auditLog;
  const originals = { findMany: auditLog.findMany, count: auditLog.count, findFirst: auditLog.findFirst };
  auditLog.findMany = async (args) => { calls.push(args.where); return [record]; };
  auditLog.count = async (args) => { calls.push(args.where); return 1; };
  auditLog.findFirst = async (args) => { calls.push(args.where); return args.where.tenantId === tenantId ? record : null; };
  try {
    const history = await service.getCompletedDisposal(tenantId);
    assert.equal(history.total, 1);
    assert.equal(history.data[0].boxCount, 1);
    const confirmation = parseDisposalConfirmation(await service.getCompletedDisposalRecord(tenantId, boxId));
    assert.equal(confirmation.tenantName, 'Spółdzielnia Łódź');
    assert.equal(confirmation.boxes[0].title, 'Teczki Łódź');
    const pdf = await buildDisposalConfirmationPdf(confirmation);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 5000);
    await assert.rejects(service.getCompletedDisposalRecord('other-tenant', boxId), { statusCode: 404 });
    assert.ok(calls.every((where) => where.entityType === 'disposal_batch' && where.action === 'disposal.batch_completed'));
    assert.ok(calls.slice(0, 3).every((where) => where.tenantId === tenantId));
  } finally {
    Object.assign(auditLog, originals);
  }
});

test('disposal decisions require a reason, protocol and explicit confirmation', () => {
  assert.equal(approveDisposalSchema.safeParse({ boxIds: [boxId] }).success, true);
  assert.equal(rejectDisposalSchema.safeParse({ boxIds: [boxId], reason: 'Nie' }).success, false);
  assert.equal(rejectDisposalSchema.safeParse({ boxIds: [boxId], reason: 'Zła kategoria' }).success, true);
  assert.equal(completeDisposalSchema.safeParse({ boxIds: [boxId], protocolReference: 'P-1', confirmed: false }).success, false);
  assert.equal(completeDisposalSchema.safeParse({ boxIds: [boxId], protocolReference: 'P-1', confirmed: true }).success, true);
  assert.equal(completeDisposalSchema.safeParse({ boxIds: Array(501).fill(boxId), protocolReference: 'P-1', confirmed: true }).success, false);
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
