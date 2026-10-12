import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DisposalEvidenceService } = require('../dist/modules/retention/disposal-evidence.service.js');
const { buildDisposalConfirmationPdf } = require('../dist/modules/retention/disposal-confirmation.js');
const tenantId = '1f11541e-00c7-4bbd-8059-bbb7d189a013';
const batchId = 'a07ca020-f00e-485c-9d01-f9ed697e2f40';
const userId = '0ab09ae1-75cb-4e65-9342-8b613196271f';
const png = readFileSync(new URL('../../client/public/icons/icon-192.png', import.meta.url));
const digest = createHash('sha256').update(png).digest('hex');
const file = { buffer: png, mimetype: 'image/png', originalname: 'dowod.png' };

function fixture(options = {}) {
  const rows = [];
  const objects = new Map();
  const deleted = [];
  let count = options.count ?? 0;
  const db = {
    auditLog: { findFirst: async ({ where }) => {
      assert.equal(where.tenantId, tenantId);
      assert.equal(where.entityId, batchId);
      return options.missingBatch ? null : { id: 'audit-id' };
    } },
    disposalEvidence: {
      count: async () => count,
      findFirst: async ({ where }) => rows.find((row) => row.tenantId === where.tenantId && row.batchId === where.batchId &&
        (where.id ? row.id === where.id : row.checksumSha256 === where.checksumSha256)) ?? null,
      create: async ({ data }) => {
        if (options.createFails) throw new Error('database unavailable');
        const row = { id: 'evidence-id', uploadedAt: new Date('2026-10-12T12:00:00Z'), ...data };
        rows.push(row);
        count++;
        return row;
      },
      findMany: async ({ where }) => rows.filter((row) => row.tenantId === where.tenantId && row.batchId === where.batchId),
    },
  };
  const storage = {
    uploadFile: async (key, buffer) => objects.set(key, buffer),
    downloadFile: async (key) => objects.get(key),
    deleteFile: async (key) => { deleted.push(key); objects.delete(key); },
  };
  return { service: new DisposalEvidenceService(db, storage), rows, objects, deleted };
}

test('upload requires a completed disposal batch in the tenant', async () => {
  const { service, objects } = fixture({ missingBatch: true });
  await assert.rejects(service.upload(tenantId, batchId, userId, file), { statusCode: 404 });
  assert.equal(objects.size, 0);
});

test('upload rejects mismatched content type and too many photos', async () => {
  const { service } = fixture();
  await assert.rejects(service.upload(tenantId, batchId, userId, { ...file, mimetype: 'image/jpeg' }), { statusCode: 400 });
  await assert.rejects(service.upload(tenantId, batchId, userId, { ...file, buffer: Buffer.from('not a PNG') }), { statusCode: 400 });
  const full = fixture({ count: 5 });
  await assert.rejects(full.service.upload(tenantId, batchId, userId, file), { statusCode: 409 });
});

test('upload stores scoped metadata, rejects duplicates, and verifies downloads', async () => {
  const { service, rows, objects } = fixture();
  const saved = await service.upload(tenantId, batchId, userId, file);
  assert.equal(saved.checksumSha256, digest);
  assert.equal(rows[0].fileSize, png.length);
  assert.match(rows[0].storageKey, new RegExp(`^${tenantId}/disposal/${batchId}/`));
  assert.deepEqual((await service.download(tenantId, batchId, saved.id)).buffer, png);
  assert.equal((await service.list(tenantId, batchId)).length, 1);
  await assert.rejects(service.upload(tenantId, batchId, userId, file), { statusCode: 409 });
  await assert.rejects(service.download('other-tenant', batchId, saved.id), { statusCode: 404 });
  objects.set(rows[0].storageKey, Buffer.from('modified'));
  await assert.rejects(service.download(tenantId, batchId, saved.id), /Suma kontrolna/);
  await assert.rejects(service.forPdf(tenantId, batchId), /Suma kontrolna/);
});

test('failed database write removes uploaded object', async () => {
  const { service, objects, deleted } = fixture({ createFails: true });
  await assert.rejects(service.upload(tenantId, batchId, userId, file), /database unavailable/);
  assert.equal(objects.size, 0);
  assert.equal(deleted.length, 1);
});

test('confirmation PDF includes photo as a separate page', async () => {
  const { service } = fixture();
  await service.upload(tenantId, batchId, userId, file);
  const record = {
    id: batchId, tenantName: 'Klient', completedBy: 'Operator',
    completedAt: new Date('2026-10-12T11:00:00Z'), protocolReference: 'BR-1',
    methodDescription: null, weightKg: null, executionNote: null,
    boxes: [{ id: 'box-id', boxNumber: 'K-1', title: 'Akta', location: 'Magazyn' }],
  };
  const without = await buildDisposalConfirmationPdf(record);
  const withPhoto = await buildDisposalConfirmationPdf(record, await service.forPdf(tenantId, batchId));
  assert.match(withPhoto.subarray(0, 8).toString(), /^%PDF-/);
  assert.ok(withPhoto.length > without.length);
  assert.equal((withPhoto.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 2);
});
