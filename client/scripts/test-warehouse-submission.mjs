import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearAllWarehouseSubmissions, clearWarehouseSubmission, readWarehouseSubmission,
  saveWarehouseSubmission, warehouseSubmissionKey,
} from '../src/utils/warehouseSubmission.ts';

const values = new Map();
globalThis.localStorage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, value); },
  removeItem(key) { values.delete(key); },
};

const entry = {
  operationId: '1ccdc011-533f-4728-8f82-cd548a2637f0',
  ids: ['a07ca020-f00e-485c-9d01-f9ed697e2f40'],
  locationId: '08675a3a-8a69-477a-82f1-b52d74b97bde',
  locationLabel: 'Magazyn / Regał 1 / Półka 1',
  notes: 'Seal intact',
  createdAt: 1,
};

test('confirmed warehouse request survives reload and cannot be silently replaced', () => {
  values.clear();
  const key = warehouseSubmissionKey('user-a', 'tenant-a', 'receive');
  assert.equal(saveWarehouseSubmission(key, entry), true);
  assert.deepEqual(readWarehouseSubmission(key), entry);
  assert.equal(saveWarehouseSubmission(key, { ...entry, operationId: 'other' }), false);
  assert.equal(clearWarehouseSubmission(key, 'other'), false);
  assert.deepEqual(readWarehouseSubmission(key), entry);
  assert.equal(clearWarehouseSubmission(key, entry.operationId), true);
  assert.equal(readWarehouseSubmission(key), null);
});

test('requests are isolated by user, tenant and type and cleared on logout', () => {
  values.clear();
  const key = warehouseSubmissionKey('user-a', 'tenant-a', 'move');
  saveWarehouseSubmission(key, entry);
  for (const other of [
    warehouseSubmissionKey('user-b', 'tenant-a', 'move'),
    warehouseSubmissionKey('user-a', 'tenant-b', 'move'),
    warehouseSubmissionKey('user-a', 'tenant-a', 'receive'),
  ]) assert.equal(readWarehouseSubmission(other), null);
  values.set('tenantId', 'tenant-a');
  clearAllWarehouseSubmissions();
  assert.equal(readWarehouseSubmission(key), null);
  assert.equal(values.get('tenantId'), 'tenant-a');
});
