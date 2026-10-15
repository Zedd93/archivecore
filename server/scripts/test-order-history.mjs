import assert from 'node:assert/strict';
import test from 'node:test';
import history from '../src/modules/orders/order-history.ts';

const { toOrderHistoryEntry, toOrderSlaHistoryEntry, mergeOrderHistory } = history;
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

test('SLA history includes only the recorded level and no tenant or notification data', () => {
  const entry = toOrderSlaHistoryEntry({
    id: 'sla-1', level: 120, createdAt, tenantId: 'private-tenant',
  });
  assert.deepEqual(entry, {
    id: 'sla-1', action: 'order.sla_120', entityType: 'order',
    createdAt, user: null, reason: null,
  });
});

test('audit and SLA events share chronological pagination without duplicates', () => {
  const logs = [
    { id: 'audit-3', action: 'order.approve', entityType: 'order', createdAt: new Date('2026-10-15T10:00:00Z'), user: null, reason: null },
    { id: 'audit-2', action: 'order.submit', entityType: 'order', createdAt: new Date('2026-10-15T08:00:00Z'), user: null, reason: null },
    { id: 'audit-1', action: 'order.create', entityType: 'order', createdAt: new Date('2026-10-15T06:00:00Z'), user: null, reason: null },
  ];
  const events = [
    { id: 'sla-100', level: 100, createdAt: new Date('2026-10-15T09:00:00Z') },
    { id: 'sla-80', level: 80, createdAt: new Date('2026-10-15T07:00:00Z') },
  ];
  const firstPage = mergeOrderHistory(logs.slice(0, 2), events, 0, 2);
  const secondPage = mergeOrderHistory(logs, events, 2, 2);
  const thirdPage = mergeOrderHistory(logs, events, 4, 2);
  assert.deepEqual([...firstPage, ...secondPage, ...thirdPage].map((entry) => entry.id),
    ['audit-3', 'sla-100', 'audit-2', 'sla-80', 'audit-1']);
});
