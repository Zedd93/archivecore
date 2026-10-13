import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { OrderHandoverPhotoService } = require('../dist/modules/orders/order-handover-photo.service.js');
const tenantId = '1f11541e-00c7-4bbd-8059-bbb7d189a013';
const orderId = 'a07ca020-f00e-485c-9d01-f9ed697e2f40';
const boxId = '8d941733-eb12-4a0c-ab1d-08abdbfdc100';
const userId = '0ab09ae1-75cb-4e65-9342-8b613196271f';
const png = readFileSync(new URL('../../client/public/icons/icon-192.png', import.meta.url));
const file = { buffer: png, mimetype: 'image/png', originalname: 'przekazanie.png' };

function fixture(options = {}) {
  const rows = [];
  const objects = new Map();
  const deleted = [];
  const db = {
    orderHandoverProof: { findFirst: async ({ where }) => {
      assert.equal(where.order.tenantId, tenantId);
      return options.missingProof || where.orderId !== orderId ? null : { orderId };
    } },
    orderHandoverBox: { findUnique: async ({ where }) => where.orderId_boxId.boxId === boxId ? { boxId } : null },
    orderHandoverPhoto: {
      count: async () => options.count ?? rows.length,
      findFirst: async ({ where }) => rows.find((row) => row.tenantId === where.tenantId && row.orderId === where.orderId &&
        (where.id ? row.id === where.id : row.checksumSha256 === where.checksumSha256)) ?? null,
      create: async ({ data }) => {
        if (options.createFails) throw new Error('database unavailable');
        const row = { id: 'photo-id', uploadedAt: new Date('2026-10-13T12:00:00Z'), ...data };
        rows.push(row);
        return row;
      },
      findMany: async ({ where }) => rows.filter((row) => row.tenantId === where.tenantId && row.orderId === where.orderId),
    },
  };
  const storage = {
    uploadFile: async (key, buffer) => objects.set(key, buffer),
    downloadFile: async (key) => objects.get(key),
    deleteFile: async (key) => { deleted.push(key); objects.delete(key); },
  };
  return { service: new OrderHandoverPhotoService(db, storage), rows, objects, deleted };
}

test('requires a handover proof in the selected tenant', async () => {
  const { service, objects } = fixture({ missingProof: true });
  await assert.rejects(service.upload(tenantId, orderId, userId, file), { statusCode: 404 });
  assert.equal(objects.size, 0);
});

test('restricts target box to the handover and validates image and limit', async () => {
  const { service } = fixture();
  await assert.rejects(service.upload(tenantId, orderId, userId, file, 'other-box'), { statusCode: 400 });
  await assert.rejects(service.upload(tenantId, orderId, userId, { ...file, mimetype: 'image/jpeg' }), { statusCode: 400 });
  await assert.rejects(service.upload(tenantId, orderId, userId, { ...file, buffer: Buffer.from('fake') }), { statusCode: 400 });
  await assert.rejects(fixture({ count: 10 }).service.upload(tenantId, orderId, userId, file), { statusCode: 409 });
});

test('stores scoped metadata, rejects duplicates, and checks downloaded bytes', async () => {
  const { service, rows, objects } = fixture();
  const saved = await service.upload(tenantId, orderId, userId, file, boxId);
  assert.equal(saved.boxId, boxId);
  assert.equal(saved.checksumSha256, createHash('sha256').update(png).digest('hex'));
  assert.match(rows[0].storageKey, new RegExp(`^${tenantId}/handover/${orderId}/`));
  assert.deepEqual((await service.download(tenantId, orderId, saved.id)).buffer, png);
  assert.equal((await service.list(tenantId, orderId)).length, 1);
  await assert.rejects(service.upload(tenantId, orderId, userId, file), { statusCode: 409 });
  await assert.rejects(service.download(tenantId, 'other-order', saved.id), { statusCode: 404 });
  objects.set(rows[0].storageKey, Buffer.from('modified'));
  await assert.rejects(service.download(tenantId, orderId, saved.id), /Suma kontrolna/);
});

test('removes uploaded object if metadata save fails', async () => {
  const { service, objects, deleted } = fixture({ createFails: true });
  await assert.rejects(service.upload(tenantId, orderId, userId, file), /database unavailable/);
  assert.equal(objects.size, 0);
  assert.equal(deleted.length, 1);
});
