import assert from 'node:assert/strict';
import test from 'node:test';
import history from '../src/modules/orders/order-history.ts';

const { toOrderHistoryEntry } = history;
const createdAt = new Date('2026-10-15T08:00:00.000Z');

test('rejection history contains actor, time and reason without raw audit data', () => {
  const entry = toOrderHistoryEntry({
    id: 'log-1', action: 'order.reject', createdAt,
    oldValues: { notes: 'Original request', tenantId: 'tenant-secret' },
    newValues: { notes: 'Missing authorization', items: [{ title: 'Private document' }] },
    user: { firstName: 'Anna', lastName: 'Nowak' },
  });
  assert.deepEqual(entry, {
    id: 'log-1', action: 'order.reject', entityType: 'order', createdAt,
    user: { firstName: 'Anna', lastName: 'Nowak' }, reason: 'Missing authorization',
  });
  assert.equal(JSON.stringify(entry).includes('Private document'), false);
  assert.equal(JSON.stringify(entry).includes('tenant-secret'), false);
});

test('cancel without a new note does not mislabel original request as reason', () => {
  const entry = toOrderHistoryEntry({
    id: 'log-2', action: 'order.cancel', createdAt,
    oldValues: { notes: 'Original request' },
    newValues: { notes: 'Original request' },
    user: null,
  });
  assert.equal(entry.reason, null);
});

test('a new cancellation note is shown as its decision reason', () => {
  const entry = toOrderHistoryEntry({
    id: 'log-3', action: 'order.cancel', createdAt,
    oldValues: { notes: 'Original request' },
    newValues: { notes: 'The request is no longer needed' },
    user: { firstName: 'Jan', lastName: 'Kowalski' },
  });
  assert.equal(entry.reason, 'The request is no longer needed');
});
