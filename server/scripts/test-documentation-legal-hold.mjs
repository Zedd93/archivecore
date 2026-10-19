import assert from 'node:assert/strict';
import test from 'node:test';

const { prisma } = await import('../src/config/database.ts');
const { DocumentationLegalHoldService } = await import('../src/modules/retention/documentation-legal-hold.service.ts');
const { DocumentService } = await import('../src/modules/documents/document.service.ts');
const { BoxService } = await import('../src/modules/boxes/box.service.ts');
const { HRService } = await import('../src/modules/hr/hr.service.ts');
const { TransferListService } = await import('../src/modules/transfer-lists/transfer-list.service.ts');
const { AuditService } = await import('../src/modules/audit/audit.service.ts');
const { documentationLegalHoldSchema } = await import('../../shared/src/validators/legal-hold.schema.ts');

const tenantId = 'f80b1605-370b-430f-bcda-4edbcefa2d18';
const userId = '7b7e1bc2-ce5b-4b8e-a33b-f5f2e50b738c';
const folderId = '01156cc4-f85e-48f2-9431-bb5741d4963e';
const boxId = 'bf553e80-b68e-48ba-908a-903d12e53609';

test('placing and releasing holds both require a meaningful reason', () => {
  assert.equal(documentationLegalHoldSchema.safeParse({ hold: true, reason: 'Spór sądowy' }).success, true);
  assert.equal(documentationLegalHoldSchema.safeParse({ hold: false, reason: 'Zakończono spór' }).success, true);
  assert.equal(documentationLegalHoldSchema.safeParse({ hold: false }).success, false);
  assert.equal(documentationLegalHoldSchema.safeParse({ hold: true, reason: 'x' }).success, false);
});

test('a held folder withdraws every related box from disposal and records the reason', async () => {
  const original = prisma.$transaction;
  const updates = [];
  let audit;
  prisma.$transaction = async (callback) => callback({
    folder: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where, { id: folderId, tenantId });
        return { legalHold: false, legalHoldReason: null, boxId, transferListItem: { boxId } };
      },
      updateMany: async (args) => { updates.push(args); return { count: 1 }; },
    },
    box: {
      count: async ({ where }) => { assert.deepEqual(where.id.in, [boxId]); return 0; },
      updateMany: async (args) => { updates.push(args); return { count: 1 }; },
    },
    auditLog: { create: async ({ data }) => { audit = data; } },
  });
  try {
    const result = await new DocumentationLegalHoldService().setHold('folder', folderId, tenantId, userId, true, 'Spór sądowy');
    assert.equal(result.legalHold, true);
    assert.equal(updates[0].where.tenantId, tenantId);
    assert.deepEqual(updates[1].where.status.in, ['pending_disposal', 'approved_disposal']);
    assert.equal(updates[1].data.status, 'active');
    assert.equal(audit.action, 'legal_hold.placed');
    assert.equal(audit.userId, userId);
    assert.equal(audit.newValues.reason, 'Spór sądowy');
  } finally { prisma.$transaction = original; }
});

test('a document in a disposed box cannot receive a late hold', async () => {
  const original = prisma.$transaction;
  let wrote = false;
  prisma.$transaction = async (callback) => callback({
    document: {
      findFirst: async ({ where }) => {
        assert.equal(where.tenantId, tenantId);
        return { legalHold: false, legalHoldReason: null, boxId: null, folder: { boxId, transferListItem: null } };
      },
      updateMany: async () => { wrote = true; return { count: 1 }; },
    },
    box: { count: async ({ where }) => { assert.equal(where.status, 'disposed'); return 1; } },
  });
  try {
    await assert.rejects(new DocumentationLegalHoldService().setHold('document', folderId, tenantId, userId, true, 'Spór sądowy'), { statusCode: 409 });
    assert.equal(wrote, false);
  } finally { prisma.$transaction = original; }
});

test('hold on a whole transfer list reaches boxes belonging to its items', async () => {
  const original = prisma.$transaction;
  let reset;
  prisma.$transaction = async (callback) => callback({
    transferList: {
      findFirst: async ({ where }) => { assert.equal(where.tenantId, tenantId); return { legalHold: false, legalHoldReason: null }; },
      updateMany: async () => ({ count: 1 }),
    },
    box: {
      findMany: async ({ where }) => {
        assert.equal(where.tenantId, tenantId);
        assert.equal(where.OR[0].transferListItems.some.transferListId, folderId);
        return [{ id: boxId }];
      },
      count: async () => 0,
      updateMany: async (args) => { reset = args; return { count: 1 }; },
    },
    auditLog: { create: async () => {} },
  });
  try {
    await new DocumentationLegalHoldService().setHold('transfer_list', folderId, tenantId, userId, true, 'Spór sądowy');
    assert.deepEqual(reset.where.id.in, [boxId]);
    assert.equal(reset.data.status, 'active');
  } finally { prisma.$transaction = original; }
});

test('releasing a hold is audited without automatically restarting disposal', async () => {
  const original = prisma.$transaction;
  let audit;
  let reset = false;
  prisma.$transaction = async (callback) => callback({
    folder: {
      findFirst: async () => ({ legalHold: true, legalHoldReason: 'Spór sądowy', boxId, transferListItem: null }),
      updateMany: async ({ where, data }) => { assert.equal(where.legalHold, true); assert.equal(data.legalHold, false); return { count: 1 }; },
    },
    box: { updateMany: async () => { reset = true; } },
    auditLog: { create: async ({ data }) => { audit = data; } },
  });
  try {
    await new DocumentationLegalHoldService().setHold('folder', folderId, tenantId, userId, false, 'Zakończono spór');
    assert.equal(reset, false);
    assert.equal(audit.action, 'legal_hold.released');
    assert.equal(audit.oldValues.legalHoldReason, 'Spór sądowy');
    assert.equal(audit.newValues.reason, 'Zakończono spór');
  } finally { prisma.$transaction = original; }
});

test('a held document cannot be deleted', async () => {
  const original = prisma.$transaction;
  let deleted = false;
  prisma.$transaction = async (callback) => callback({ document: {
    findFirst: async ({ where }) => { assert.equal(where.tenantId, tenantId); return { legalHold: true, folder: null, box: null }; },
    delete: async () => { deleted = true; },
  } });
  try {
    await assert.rejects(new DocumentService().delete(folderId, tenantId), { statusCode: 409 });
    assert.equal(deleted, false);
  } finally { prisma.$transaction = original; }
});

test('a document inherits a transfer-list hold through its folder', async () => {
  const original = prisma.$transaction;
  let deleted = false;
  prisma.$transaction = async (callback) => callback({ document: {
    findFirst: async () => ({
      legalHold: false, box: null,
      folder: { legalHold: false, box: null, transferListItem: { transferList: { legalHold: true } } },
    }),
    delete: async () => { deleted = true; },
  } });
  try {
    await assert.rejects(new DocumentService().delete(folderId, tenantId), { statusCode: 409 });
    assert.equal(deleted, false);
  } finally { prisma.$transaction = original; }
});

test('a document in a held JRWA series cannot be deleted', async () => {
  const original = prisma.$transaction;
  let deleted = false;
  prisma.$transaction = async (callback) => callback({ document: {
    findFirst: async () => ({
      legalHold: false, box: null,
      folder: { legalHold: false, retentionPolicy: { seriesLegalHold: true }, box: null, transferListItem: null },
    }),
    delete: async () => { deleted = true; },
  } });
  try {
    await assert.rejects(new DocumentService().delete(folderId, tenantId), { statusCode: 409 });
    assert.equal(deleted, false);
  } finally { prisma.$transaction = original; }
});

test('a document inherits a JRWA hold from a box linked through its transfer-list item', async () => {
  const original = prisma.$transaction;
  let deleted = false;
  prisma.$transaction = async (callback) => callback({ document: {
    findFirst: async () => ({
      legalHold: false, box: null,
      folder: {
        legalHold: false, retentionPolicy: null, box: null,
        transferListItem: { transferList: { legalHold: false }, box: { legalHold: false, retentionPolicy: { seriesLegalHold: true } } },
      },
    }),
    delete: async () => { deleted = true; },
  } });
  try {
    await assert.rejects(new DocumentService().delete(folderId, tenantId), { statusCode: 409 });
    assert.equal(deleted, false);
  } finally { prisma.$transaction = original; }
});

test('an item classified under a held JRWA series cannot be deleted', async () => {
  const original = prisma.$transaction;
  let deleted = false;
  prisma.$transaction = async (callback) => callback({
    transferList: { findFirst: async () => ({ status: 'draft', legalHold: false }) },
    transferListItem: {
      findFirst: async () => ({
        id: folderId, box: null,
        folder: { legalHold: false, retentionPolicy: { seriesLegalHold: true }, box: null, documents: [] },
      }),
      delete: async () => { deleted = true; },
    },
  });
  try {
    await assert.rejects(new TransferListService().deleteItem(folderId, folderId, tenantId), { statusCode: 409 });
    assert.equal(deleted, false);
  } finally { prisma.$transaction = original; }
});

test('items cannot be removed from a held transfer list', async () => {
  const original = prisma.$transaction;
  let deleted = false;
  prisma.$transaction = async (callback) => callback({
    transferList: { findFirst: async ({ where }) => { assert.equal(where.tenantId, tenantId); return { status: 'draft', legalHold: true }; } },
    transferListItem: { delete: async () => { deleted = true; }, deleteMany: async () => { deleted = true; } },
  });
  try {
    const service = new TransferListService();
    await assert.rejects(service.deleteItem(folderId, folderId, tenantId), { statusCode: 409 });
    await assert.rejects(service.bulkDeleteItems(folderId, tenantId, [folderId]), { statusCode: 409 });
    assert.equal(deleted, false);
  } finally { prisma.$transaction = original; }
});

test('bulk deletion refuses a held folder without deleting any selected item', async () => {
  const original = prisma.$transaction;
  let deleted = false;
  prisma.$transaction = async (callback) => callback({
    transferList: { findFirst: async () => ({ status: 'draft', legalHold: false }) },
    transferListItem: {
      count: async ({ where }) => { assert.equal(where.OR[4].folder.legalHold, true); return 1; },
      deleteMany: async () => { deleted = true; return { count: 1 }; },
    },
  });
  try {
    await assert.rejects(new TransferListService().bulkDeleteItems(folderId, tenantId, [folderId]), { statusCode: 409 });
    assert.equal(deleted, false);
  } finally { prisma.$transaction = original; }
});

test('box details expose held contents even without a box-level hold', async () => {
  const originalBox = prisma.box.findFirst;
  const originalFolderCount = prisma.folder.count;
  const originalDocumentCount = prisma.document.count;
  const originalItemCount = prisma.transferListItem.count;
  prisma.box.findFirst = async () => ({ id: boxId, legalHold: false });
  prisma.folder.count = async ({ where }) => { assert.equal(where.tenantId, tenantId); return 1; };
  prisma.document.count = async ({ where }) => { assert.equal(where.tenantId, tenantId); return 2; };
  prisma.transferListItem.count = async ({ where }) => { assert.equal(where.transferList.tenantId, tenantId); return 3; };
  try {
    assert.deepEqual((await new BoxService().getById(boxId, tenantId)).heldContent,
      { folders: 1, documents: 2, transferListItems: 3 });
  } finally {
    prisma.box.findFirst = originalBox;
    prisma.folder.count = originalFolderCount;
    prisma.document.count = originalDocumentCount;
    prisma.transferListItem.count = originalItemCount;
  }
});

test('personnel documents cannot be removed while their HR folder is held', async () => {
  const original = prisma.$transaction;
  let deleted = false;
  prisma.$transaction = async (callback) => callback({ hRDocument: {
    findFirst: async () => ({ hrFolderPart: { hrFolder: { litigationHold: true } } }),
    delete: async () => { deleted = true; },
  } });
  try {
    await assert.rejects(new HRService().removeDocument(folderId, tenantId), { statusCode: 409 });
    assert.equal(deleted, false);
  } finally { prisma.$transaction = original; }
});

test('audit revert cannot change a folder while it is under legal hold', async () => {
  const service = new AuditService();
  service.getById = async () => ({
    id: 'audit-a', entityType: 'folder', entityId: folderId, action: 'folder.update', oldValues: { title: 'Dawny tytuł' },
  });
  const originalFind = prisma.folder.findFirst;
  const originalUpdate = prisma.folder.update;
  let updated = false;
  prisma.folder.findFirst = async ({ where }) => {
    assert.equal(where.id, folderId);
    assert.equal(where.OR[0].legalHold, true);
    return { id: folderId };
  };
  prisma.folder.update = async () => { updated = true; };
  try {
    await assert.rejects(service.revert('audit-a', userId), { statusCode: 409 });
    assert.equal(updated, false);
  } finally {
    prisma.folder.findFirst = originalFind;
    prisma.folder.update = originalUpdate;
  }
});

test('audit revert never restores old legal-hold fields from an ordinary update', async () => {
  const service = new AuditService();
  service.getById = async () => ({
    id: 'audit-b', entityType: 'folder', entityId: folderId, tenantId, action: 'folder.update',
    oldValues: { title: 'Dawny tytuł', legalHold: false, legalHoldReason: null, legalHoldAt: null },
  });
  const originalFind = prisma.folder.findFirst;
  const originalUpdate = prisma.folder.update;
  const originalAudit = prisma.auditLog.create;
  prisma.folder.findFirst = async () => null;
  prisma.folder.update = async ({ data }) => {
    assert.deepEqual(data, { title: 'Dawny tytuł' });
    return { id: folderId, title: data.title };
  };
  prisma.auditLog.create = async () => ({});
  try {
    assert.equal((await service.revert('audit-b', userId)).reverted, true);
  } finally {
    prisma.folder.findFirst = originalFind;
    prisma.folder.update = originalUpdate;
    prisma.auditLog.create = originalAudit;
  }
});
