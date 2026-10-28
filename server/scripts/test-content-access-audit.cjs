const test = require('node:test');
const assert = require('node:assert/strict');
const { prisma } = require('../dist/config/database');
const { recordContentAccess } = require('../dist/middleware/audit');
const { attachmentController } = require('../dist/modules/attachments/attachment.controller');
const { attachmentService } = require('../dist/modules/attachments/attachment.service');
const { documentController } = require('../dist/modules/documents/document.controller');
const { documentService } = require('../dist/modules/documents/document.service');
const { Permissions } = require('@archivecore/shared');

const tenantId = '1f11541e-00c7-4bbd-8059-bbb7d189a013';
const userId = '0ab09ae1-75cb-4e65-9342-8b613196271f';
const documentId = '34303393-0db4-49fd-b0d2-cae4f8971422';
const attachmentId = 'db7c235e-661f-4bcb-bbf7-6c3d414a5d46';

function request(id = attachmentId) {
  return {
  tenantId, user: { userId, permissions: [] }, accessDepartment: 'Księgowość', params: { id },
    headers: { 'user-agent': 'audit-test', 'x-forwarded-for': '198.51.100.10' },
    ips: [], ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' },
  };
}

function response() {
  const headers = {};
  return {
    headers, body: undefined, statusCode: 200,
    setHeader(name, value) { headers[name] = value; },
    send(body) { this.body = body; return this; },
    json(body) { this.body = body; return this; },
    status(code) { this.statusCode = code; return this; },
  };
}

test('audit access stores identity and identifiers, never document contents', async () => {
  let saved;
  const db = { auditLog: { create: async (query) => { saved = query.data; } } };
  await recordContentAccess(request(documentId), 'document.read', 'document', documentId, undefined, db);
  assert.equal(saved.tenantId, tenantId);
  assert.equal(saved.userId, userId);
  assert.equal(saved.entityId, documentId);
  assert.equal(saved.ipAddress, '198.51.100.10');
  assert.equal(saved.newValues, undefined);
  assert.equal(JSON.stringify(saved).includes('filePath'), false);
  await assert.rejects(recordContentAccess({ ...request(), tenantId: null }, 'document.read', 'document', documentId, undefined, db), /kontekstu/);
});

test('attachment bytes are sent only after authorized lookup and durable audit', async () => {
  const oldDownload = attachmentService.download;
  const oldAudit = prisma.auditLog.create;
  const events = [];
  const bytes = Buffer.from('%PDF-test');
  try {
    attachmentService.download = async (id, tenant, department, canViewHr) => {
      assert.deepEqual([id, tenant, department, canViewHr], [attachmentId, tenantId, 'Księgowość', false]);
      events.push('loaded');
      return { attachment: { id, documentId, folderId: null, boxId: null, fileName: 'umowa Łódź.pdf', mimeType: 'application/pdf', filePath: 'secret/path' }, buffer: bytes };
    };
    prisma.auditLog.create = async ({ data }) => { events.push('audited'); assert.equal(data.entityId, attachmentId); };
    const res = response();
    res.send = function (body) { events.push('sent'); this.body = body; return this; };
    let error;
    await attachmentController.download(request(), res, (err) => { error = err; });
    assert.equal(error, undefined);
    assert.deepEqual(events, ['loaded', 'audited', 'sent']);
    assert.equal(res.body, bytes);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    assert.match(res.headers['Content-Disposition'], /umowa%20%C5%81%C3%B3d%C5%BA.pdf/);

    prisma.auditLog.create = async () => { throw new Error('audit unavailable'); };
    const failed = response();
    await attachmentController.download(request(), failed, (err) => { error = err; });
    assert.match(error.message, /audit unavailable/);
    assert.equal(failed.body, undefined);

    attachmentService.download = async () => { throw Object.assign(new Error('not found'), { statusCode: 404 }); };
    let auditCalls = 0;
    prisma.auditLog.create = async () => { auditCalls += 1; };
    const denied = response();
    await attachmentController.download(request(), denied, (err) => { error = err; });
    assert.equal(error.statusCode, 404);
    assert.equal(auditCalls, 0);
    assert.equal(denied.body, undefined);
  } finally {
    attachmentService.download = oldDownload;
    prisma.auditLog.create = oldAudit;
  }
});

test('attachment reads use the linked record department and hide HR files without HR access', async () => {
  const oldFindFirst = prisma.attachment.findFirst;
  const oldFindMany = prisma.attachment.findMany;
  const oldCount = prisma.attachment.count;
  const queries = [];
  try {
    prisma.attachment.findFirst = async ({ where }) => { queries.push(where); return null; };
    prisma.attachment.findMany = async ({ where }) => { queries.push(where); return []; };
    prisma.attachment.count = async ({ where }) => { queries.push(where); return 0; };

    await assert.rejects(attachmentService.getById(attachmentId, tenantId, 'Księgowość'), { statusCode: 404 });
    await attachmentService.list(tenantId, {}, 0, 20, 'Księgowość');
    assert.equal(queries.length, 3);
    for (const where of queries) {
      assert.equal(where.tenantId, tenantId);
      assert.deepEqual(where.hrDocuments, { none: {} });
      assert.equal(where.OR.length, 4);
      assert.deepEqual(where.OR[0].documentId, { not: null });
      assert.equal(where.OR[0].document.folder.box.department.equals, 'Księgowość');
      assert.equal(where.OR[1].document.box.department.equals, 'Księgowość');
      assert.deepEqual(where.OR[2].documentId, null);
      assert.equal(where.OR[2].folder.box.department.equals, 'Księgowość');
      assert.deepEqual(where.OR[3].folderId, null);
      assert.equal(where.OR[3].box.department.equals, 'Księgowość');
    }

    await assert.rejects(attachmentService.getById(attachmentId, tenantId, undefined, true), { statusCode: 404 });
    assert.equal(queries[3].hrDocuments, undefined);
    assert.equal(queries[3].OR, undefined);
  } finally {
    prisma.attachment.findFirst = oldFindFirst;
    prisma.attachment.findMany = oldFindMany;
    prisma.attachment.count = oldCount;
  }
});

test('attachment controllers forward HR access to both list and download', async () => {
  const oldList = attachmentService.list;
  const oldDownload = attachmentService.download;
  const oldAudit = prisma.auditLog.create;
  try {
    attachmentService.list = async (_tenant, _filters, _skip, _take, department, canViewHr) => {
      assert.equal(department, 'Księgowość');
      assert.equal(canViewHr, true);
      return { data: [], total: 0 };
    };
    attachmentService.download = async (_id, _tenant, department, canViewHr) => {
      assert.equal(department, 'Księgowość');
      assert.equal(canViewHr, true);
      return { attachment: { id: attachmentId, fileName: 'test.pdf', mimeType: 'application/pdf' }, buffer: Buffer.from('%PDF-test') };
    };
    prisma.auditLog.create = async () => ({});
    const req = { ...request(), user: { userId, permissions: [Permissions.HR_VIEW] }, query: {} };
    let error;
    await attachmentController.list(req, response(), (err) => { error = err; });
    assert.equal(error, undefined);
    await attachmentController.download(req, response(), (err) => { error = err; });
    assert.equal(error, undefined);
  } finally {
    attachmentService.list = oldList;
    attachmentService.download = oldDownload;
    prisma.auditLog.create = oldAudit;
  }
});

test('attachment upload rejects missing and invalid targets before file storage', async () => {
  const file = { originalname: 'test.pdf', buffer: Buffer.from('test'), mimetype: 'application/pdf', size: 4 };
  await assert.rejects(attachmentService.upload(file, tenantId, userId, {}), { statusCode: 400 });
  await assert.rejects(attachmentService.upload(file, tenantId, userId, { boxId: 'not-a-uuid' }), { statusCode: 400 });
});

test('attachment upload verifies tenant ownership and consistent links', async () => {
  const oldDocument = prisma.document.findFirst;
  const oldFolder = prisma.folder.findFirst;
  const oldBox = prisma.box.findFirst;
  const folderId = 'cc6df9bc-42be-4d48-bfb2-5290710c52a2';
  const boxId = '7198f438-e0c8-48d7-8b10-339fb73870b2';
  const otherBoxId = '41675e62-1862-47b2-bbf9-3b1234d7a705';
  try {
    prisma.document.findFirst = async ({ where }) => {
      assert.equal(where.tenantId, tenantId);
      return null;
    };
    await assert.rejects(attachmentService.validateUploadRelations(tenantId, {
      documentId,
    }), { statusCode: 404 });

    prisma.document.findFirst = async ({ where }) => {
      assert.equal(where.tenantId, tenantId);
      return { folderId, boxId };
    };
    prisma.folder.findFirst = async ({ where }) => {
      assert.equal(where.tenantId, tenantId);
      return where.id === folderId ? { boxId } : null;
    };
    prisma.box.findFirst = async ({ where }) => {
      assert.equal(where.tenantId, tenantId);
      assert.equal(where.deletedAt, null);
      return where.id === boxId ? { department: 'Księgowość' } : null;
    };

    await assert.rejects(attachmentService.validateUploadRelations(tenantId, {
      documentId, folderId: '528b94df-f0cd-4109-92e8-c4f0c6b14dda',
    }), { statusCode: 400 });
    await assert.rejects(attachmentService.validateUploadRelations(tenantId, {
      documentId, folderId, boxId: otherBoxId,
    }), { statusCode: 400 });
    await assert.rejects(attachmentService.validateUploadRelations(tenantId, {
      folderId: '528b94df-f0cd-4109-92e8-c4f0c6b14dda',
    }), { statusCode: 404 });
    await assert.rejects(attachmentService.validateUploadRelations(tenantId, {
      boxId: otherBoxId,
    }), { statusCode: 404 });
    assert.deepEqual(await attachmentService.validateUploadRelations(tenantId, {
      documentId, folderId, boxId,
    }, 'księgowość'), { documentId, folderId, boxId });
    await assert.rejects(attachmentService.validateUploadRelations(tenantId, {
      documentId,
    }, 'Kadry'), { statusCode: 403 });
  } finally {
    prisma.document.findFirst = oldDocument;
    prisma.folder.findFirst = oldFolder;
    prisma.box.findFirst = oldBox;
  }
});

test('attachment upload controller forwards employee department', async () => {
  const oldUpload = attachmentService.upload;
  try {
    attachmentService.upload = async (_file, tenant, actor, relations, department) => {
      assert.equal(tenant, tenantId);
      assert.equal(actor, userId);
      assert.equal(relations.boxId, '7198f438-e0c8-48d7-8b10-339fb73870b2');
      assert.equal(department, 'Księgowość');
      return { id: attachmentId };
    };
    const req = { ...request(), file: { originalname: 'test.pdf' }, body: { boxId: '7198f438-e0c8-48d7-8b10-339fb73870b2' } };
    let error;
    const res = response();
    await attachmentController.upload(req, res, (err) => { error = err; });
    assert.equal(error, undefined);
    assert.equal(res.statusCode, 201);
  } finally {
    attachmentService.upload = oldUpload;
  }
});

test('document detail is audited only after tenant-scoped read and before response', async () => {
  const oldGet = documentService.getById;
  const oldAudit = prisma.auditLog.create;
  const events = [];
  try {
    documentService.getById = async (id, tenant, department) => {
      assert.deepEqual([id, tenant, department], [documentId, tenantId, 'Księgowość']);
      events.push('loaded');
      return { id, title: 'Poufny dokument' };
    };
    prisma.auditLog.create = async ({ data }) => {
      assert.deepEqual([data.action, data.entityType, data.entityId], ['document.read', 'document', documentId]);
      assert.equal(data.newValues, undefined);
      events.push('audited');
    };
    const res = response();
    res.json = function (body) { events.push('sent'); this.body = body; return this; };
    let error;
    await documentController.getById(request(documentId), res, (err) => { error = err; });
    assert.equal(error, undefined);
    assert.deepEqual(events, ['loaded', 'audited', 'sent']);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    assert.equal(JSON.stringify(events).includes('Poufny dokument'), false);

    prisma.auditLog.create = async () => { throw new Error('audit unavailable'); };
    const failed = response();
    await documentController.getById(request(documentId), failed, (err) => { error = err; });
    assert.match(error.message, /audit unavailable/);
    assert.equal(failed.body, undefined);
  } finally {
    documentService.getById = oldGet;
    prisma.auditLog.create = oldAudit;
  }
});
