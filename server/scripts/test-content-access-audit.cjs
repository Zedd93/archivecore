const test = require('node:test');
const assert = require('node:assert/strict');
const { prisma } = require('../dist/config/database');
const { recordContentAccess } = require('../dist/middleware/audit');
const { attachmentController } = require('../dist/modules/attachments/attachment.controller');
const { attachmentService } = require('../dist/modules/attachments/attachment.service');
const { documentController } = require('../dist/modules/documents/document.controller');
const { documentService } = require('../dist/modules/documents/document.service');

const tenantId = '1f11541e-00c7-4bbd-8059-bbb7d189a013';
const userId = '0ab09ae1-75cb-4e65-9342-8b613196271f';
const documentId = '34303393-0db4-49fd-b0d2-cae4f8971422';
const attachmentId = 'db7c235e-661f-4bcb-bbf7-6c3d414a5d46';

function request(id = attachmentId) {
  return {
    tenantId, user: { userId }, accessDepartment: 'Księgowość', params: { id },
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
    attachmentService.download = async (id, tenant, department) => {
      assert.deepEqual([id, tenant, department], [attachmentId, tenantId, 'Księgowość']);
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
