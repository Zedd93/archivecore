import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TZ = 'Europe/Warsaw';
const slaModule = await import('../src/modules/orders/order-sla.ts');
const serviceModule = await import('../src/modules/orders/order-sla.service.ts');
const orderModule = await import('../src/modules/orders/order.service.ts');
const { businessMinutesBetween, slaEscalationLevel } = slaModule;
const { OrderSlaService } = serviceModule;
const { OrderService } = orderModule;

test('business time excludes the weekend and time outside opening hours', () => {
  const friday = new Date('2026-10-16T13:00:00Z'); // 15:00 Warsaw
  const monday = new Date('2026-10-19T07:00:00Z'); // 09:00 Warsaw
  assert.equal(businessMinutesBetween(friday, monday), 120);
});

test('80, 100 and 120 percent are based on working time', () => {
  const deadline = new Date('2026-10-19T08:00:00Z'); // Monday 10:00 Warsaw
  assert.equal(slaEscalationLevel(deadline, 'urgent', new Date('2026-10-16T13:00:00Z')), null);
  assert.equal(slaEscalationLevel(deadline, 'urgent', new Date('2026-10-19T06:24:00Z')), 80);
  assert.equal(slaEscalationLevel(deadline, 'urgent', deadline), 100);
  assert.equal(slaEscalationLevel(deadline, 'urgent', new Date('2026-10-19T09:35:00Z')), 100);
  assert.equal(slaEscalationLevel(deadline, 'urgent', new Date('2026-10-19T09:36:00Z')), 120);
});

test('submission starts a fresh SLA window instead of using draft creation time', () => {
  const service = new OrderService();
  const before = new Date();
  const update = service.getStatusUpdateData({ priority: 'urgent', notes: null }, 'submitted', 'requester');
  assert.ok(update.slaDeadline instanceof Date);
  assert.ok(update.slaDeadline > before);
});

test('worker sends one warning and records its level across runs', async () => {
  const deadline = new Date('2026-10-19T08:00:00Z');
  const now = new Date('2026-10-19T06:30:00Z');
  const markers = [];
  const notifications = [];
  const order = {
    id: 'order-1', tenantId: 'tenant-1', orderNumber: 'Z-1',
    priority: 'urgent', status: 'submitted', slaDeadline: deadline,
    assignedTo: null, slaEscalations: markers,
  };
  const db = {
    order: {
      findMany: async (query) => {
        assert.deepEqual(query.where.status.in, ['submitted', 'approved', 'in_progress', 'ready']);
        assert.deepEqual(query.where.slaEscalations, { none: { level: 120 } });
        return [order];
      },
      findFirst: async () => order,
    },
    orderSlaEscalation: {
      create: async ({ data }) => {
        markers.push({ level: data.level });
        return data;
      },
    },
    user: {
      findMany: async () => [{ id: 'operator', userRoles: [{ role: { code: 'OM' } }] }],
    },
    notification: {
      createMany: async ({ data }) => {
        notifications.push(...data);
        return { count: data.length };
      },
    },
  };
  db.$transaction = async (callback) => callback(db);
  const service = new OrderSlaService(db);
  assert.equal(await service.processDue(now), 1);
  assert.equal(await new OrderSlaService(db).processDue(now), 0);
  assert.deepEqual(markers, [{ level: 80 }]);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].userId, 'operator');
  assert.equal(notifications[0].type, 'order_sla_80');
});
