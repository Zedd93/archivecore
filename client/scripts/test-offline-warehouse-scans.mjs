import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearWarehouseScans,
  readWarehouseScans,
  saveWarehouseScans,
  warehouseScanKey,
} from '../src/utils/offlineWarehouseScans.ts';

const values = new Map();
globalThis.localStorage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, value); },
  removeItem(key) { values.delete(key); },
};

test('offline scans are isolated by user, tenant and operation and cleared on logout', () => {
  values.clear();
  const move = warehouseScanKey('alice', 'tenant-a', 'move');
  const receive = warehouseScanKey('alice', 'tenant-a', 'receive');
  const otherTenant = warehouseScanKey('alice', 'tenant-b', 'move');
  const otherUser = warehouseScanKey('bob', 'tenant-a', 'move');
  assert.equal(saveWarehouseScans(move, ['AC:box']), true);
  assert.deepEqual(readWarehouseScans(move), ['AC:box']);
  for (const key of [receive, otherTenant, otherUser]) assert.deepEqual(readWarehouseScans(key), []);
  values.set('tenantId', 'tenant-a');
  clearWarehouseScans();
  assert.deepEqual(readWarehouseScans(move), []);
  assert.equal(values.get('tenantId'), 'tenant-a');
});

test('malformed scans are ignored and the batch limit is enforced', () => {
  values.clear();
  const key = warehouseScanKey('alice', 'tenant-a', 'move');
  values.set(key, '{broken');
  assert.deepEqual(readWarehouseScans(key), []);
  assert.equal(saveWarehouseScans(key, Array(201).fill('AC:box')), false);
  assert.deepEqual(readWarehouseScans(key), []);
});
