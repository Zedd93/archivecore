import assert from 'node:assert/strict';
import test from 'node:test';

const { OrderReturnReminderService, returnReminderKind } = await import('../src/modules/orders/order-return-reminder.service.ts');

test('Warsaw calendar day determines reminders across DST and due-day boundary', () => {
  const due = new Date('2026-10-25T12:00:00Z');
  assert.equal(returnReminderKind(due, new Date('2026-10-24T21:30:00Z')), 'upcoming');
  assert.equal(returnReminderKind(due, new Date('2026-10-25T22:30:00Z')), null);
  assert.equal(returnReminderKind(due, new Date('2026-10-25T23:30:00Z')), 'overdue');
  assert.equal(returnReminderKind(new Date('2026-10-26T12:00:00Z'), new Date('2026-10-24T21:30:00Z')), null);
});

function setup({ dueAt = '2026-10-17T12:00:00Z', requesterTenantId = 'tenant-a' } = {}) {
  const recorded = new Set();
  const notifications = [];
  const queries = [];
  let remaining = 2;
  let recipients = 1;
  const order = {
    id: '8a4b7d9a-89e2-4f5f-9c75-cf3f37e1543e', tenantId: 'tenant-a',
    orderNumber: 'Z-202610-00001', requestedBy: 'requester-a',
    requester: { tenantId: requesterTenantId }, expectedReturnAt: new Date(dueAt),
  };
  const snapshot = () => ({ ...order, returnReminders: [...recorded].map((kind) => ({ kind })) });
  const db = {
    order: {
      findMany: async (args) => {
        queries.push(args);
        return remaining > 0 ? [snapshot()] : [];
      },
    },
    $transaction: async (callback) => {
      const before = new Set(recorded);
      const tx = {
        $queryRaw: async (sql) => {
          assert.match(sql.sql, /FOR UPDATE/);
          return [{ id: order.id }];
        },
        order: {
          findFirst: async ({ where }) => {
            assert.equal(where.orderType, 'checkout');
            assert.deepEqual(where.items, { some: { itemStatus: 'delivered' } });
            return remaining > 0 ? snapshot() : null;
          },
        },
        orderReturnReminder: {
          create: async ({ data }) => {
            assert.equal(data.orderId, order.id);
            if (recorded.has(data.kind)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
            recorded.add(data.kind);
          },
        },
      };
      try { return await callback(tx); }
      catch (error) {
        recorded.clear();
        for (const kind of before) recorded.add(kind);
        throw error;
      }
    },
  };
  const notifier = { notifyTenantUsers: async (payload, tx) => {
    assert.ok(tx.orderReturnReminder);
    notifications.push(payload);
    return { count: recipients };
  } };
  return {
    service: new OrderReturnReminderService(db, notifier), recorded, notifications, queries,
    setRemaining: (value) => { remaining = value; },
    setRecipients: (value) => { recipients = value; },
  };
}

test('upcoming notice is one-time and addressed only to this tenant requester', async () => {
  const state = setup();
  const now = new Date('2026-10-16T10:00:00Z');
  assert.equal(await state.service.processDue(now), 1);
  assert.equal(await state.service.processDue(now), 0);
  assert.deepEqual([...state.recorded], ['upcoming']);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].type, 'loan_return_upcoming');
  assert.equal(state.notifications[0].tenantId, 'tenant-a');
  assert.equal(state.notifications[0].onlyIncludedUsers, true);
  assert.deepEqual(state.notifications[0].includeUserIds, ['requester-a']);
  assert.equal(state.notifications[0].actionUrl, '/orders/8a4b7d9a-89e2-4f5f-9c75-cf3f37e1543e');
  assert.deepEqual(state.queries[0].where.items, { some: { itemStatus: 'delivered' } });
  assert.deepEqual(state.queries[0].where.status, { in: ['delivered', 'completed'] });
  assert.deepEqual(state.queries[0].where.OR[1].returnReminders, { none: { kind: 'overdue' } });
});

test('overdue notice includes tenant leadership once while some items remain out', async () => {
  const state = setup({ dueAt: '2026-10-14T12:00:00Z' });
  state.setRemaining(1);
  const now = new Date('2026-10-16T10:00:00Z');
  assert.equal(await state.service.processDue(now), 1);
  assert.equal(await state.service.processDue(now), 0);
  assert.equal(state.notifications[0].type, 'loan_return_overdue');
  assert.deepEqual(state.notifications[0].requiredRoleCodes, ['TL', 'AT']);
  assert.equal(state.notifications[0].includeGlobalUsers, false);
  state.setRemaining(0);
  assert.equal(await state.service.processDue(now), 0);
});

test('a return between scan and row lock prevents reminder', async () => {
  const state = setup();
  const original = state.service.processDue;
  const db = state.service.db;
  const scan = db.order.findMany;
  db.order.findMany = async (args) => {
    const result = await scan(args);
    state.setRemaining(0);
    return result;
  };
  assert.equal(await original.call(state.service, new Date('2026-10-16T10:00:00Z')), 0);
  assert.equal(state.notifications.length, 0);
  assert.equal(state.recorded.size, 0);
});

test('no recipient rolls back claim and next run can retry', async () => {
  const state = setup();
  state.setRecipients(0);
  assert.equal(await state.service.processDue(new Date('2026-10-16T10:00:00Z')), 0);
  assert.equal(state.recorded.size, 0);
  state.setRecipients(1);
  assert.equal(await state.service.processDue(new Date('2026-10-16T10:00:00Z')), 1);
});

test('requester from another tenant is never included in overdue audience', async () => {
  const state = setup({ dueAt: '2026-10-14T12:00:00Z', requesterTenantId: 'tenant-b' });
  assert.equal(await state.service.processDue(new Date('2026-10-16T10:00:00Z')), 1);
  assert.deepEqual(state.notifications[0].includeUserIds, []);
});
