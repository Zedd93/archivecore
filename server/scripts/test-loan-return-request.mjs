import assert from 'node:assert/strict';
import test from 'node:test';

const { LoanReturnRequestService } = await import('../src/modules/orders/loan-return-request.service.ts');
const { default: orderRoutes } = await import('../src/modules/orders/order.routes.ts');

const now = new Date('2026-10-17T10:00:00Z');
const item = {
  deliveredAt: new Date('2026-10-15T10:00:00Z'),
  boxId: null, folderId: 'folder-a', documentId: null,
  transferListItemId: null, hrFolderId: null,
  box: null, folder: { boxId: 'box-a', title: 'Akta umów' }, document: null,
  transferListItem: null, hrFolder: null,
  order: {
    orderNumber: 'Z-202610-1', requestedBy: 'borrower-a',
    requester: { isActive: true, tenantId: 'tenant-a' },
  },
};

function setup({ found = item, returned = null, recent = null, lock = [{ id: 'order-a' }], actor = { firstName: 'Anna', lastName: 'Nowak' } } = {}) {
  const queries = [];
  const notifications = [];
  const audits = [];
  const db = {
    $transaction: async (fn) => fn(db),
    $queryRaw: async () => lock,
    user: { findFirst: async ({ where }) => {
      assert.equal(where.id, 'requester-b');
      assert.equal(where.isActive, true);
      return actor;
    } },
    orderItem: { findFirst: async (query) => {
      queries.push(query);
      return queries.length === 1 ? found : returned;
    } },
    notification: {
      findFirst: async (query) => { queries.push(query); return recent; },
      create: async ({ data }) => { notifications.push(data); return data; },
    },
    auditLog: { create: async ({ data }) => { audits.push(data); } },
  };
  return { service: new LoanReturnRequestService(db), queries, notifications, audits };
}

test('return request targets the responsible borrower and records an audit', async () => {
  const state = setup();
  assert.deepEqual(await state.service.request('order-a', 'item-a', 'tenant-a', 'requester-b', 'Accounting', now), { requested: true });
  assert.equal(state.queries[0].where.order.tenantId, 'tenant-a');
  assert.equal(state.queries[0].where.AND[0].OR[0].box.department.equals, 'Accounting');
  assert.equal(state.queries[1].where.OR.some((target) => target.boxId === 'box-a'), true);
  assert.equal(state.queries[1].where.OR.some((target) => target.folderId === 'folder-a'), true);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].userId, 'borrower-a');
  assert.equal(state.notifications[0].actionUrl, '/orders/order-a');
  assert.match(state.notifications[0].message, /Anna Nowak prosi o zwrot: Akta umów/);
  assert.equal(state.notifications[0].emailDelivery, undefined);
  assert.equal(state.audits[0].userId, 'requester-b');
});

test('tenant mismatch, returned item, and non-active loan create no notification', async () => {
  for (const options of [
    { lock: [] },
    { found: null },
    { returned: { id: 'return-a' } },
  ]) {
    const state = setup(options);
    await assert.rejects(state.service.request('order-a', 'item-a', 'tenant-a', 'requester-b', undefined, now),
      (error) => error.statusCode === (options.returned ? 409 : 404));
    assert.equal(state.notifications.length, 0);
  }
});

test('self requests, inactive borrowers, and another tenant are rejected', async () => {
  const self = setup();
  await assert.rejects(self.service.request('order-a', 'item-a', 'tenant-a', 'borrower-a', undefined, now), { statusCode: 409 });
  for (const requester of [
    { isActive: false, tenantId: 'tenant-a' },
    { isActive: true, tenantId: 'tenant-b' },
  ]) {
    const state = setup({ found: { ...item, order: { ...item.order, requester } } });
    await assert.rejects(state.service.request('order-a', 'item-a', 'tenant-a', 'requester-b', undefined, now), { statusCode: 409 });
    assert.equal(state.notifications.length, 0);
  }
  const inactiveActor = setup({ actor: null });
  await assert.rejects(inactiveActor.service.request('order-a', 'item-a', 'tenant-a', 'requester-b', undefined, now), { statusCode: 403 });
  assert.equal(inactiveActor.notifications.length, 0);
});

test('a return request is limited to one per loan item in 24 hours', async () => {
  const state = setup({ recent: { id: 'notification-a' } });
  await assert.rejects(state.service.request('order-a', 'item-a', 'tenant-a', 'requester-b', undefined, now), { statusCode: 409 });
  assert.equal(state.notifications.length, 0);
  assert.equal(state.queries[2].where.entityId, 'item-a');
  assert.equal(state.queries[2].where.createdAt.gte.toISOString(), '2026-10-16T10:00:00.000Z');
});

test('return request endpoint requires permission and UUIDs', () => {
  const route = orderRoutes.stack.find((layer) => layer.route?.path === '/:id/items/:itemId/request-return')?.route;
  assert.ok(route);
  const permission = route.stack[2].handle;
  const validation = route.stack[3].handle;
  const res = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const denied = res();
  permission({ user: { permissions: [] } }, denied, () => { throw new Error('permission bypassed'); });
  assert.equal(denied.statusCode, 403);
  const accepted = res();
  let allowed = false;
  permission({ user: { permissions: ['order.create'] } }, accepted, () => { allowed = true; });
  assert.equal(allowed, true);
  const invalid = res();
  validation({ params: { id: 'invalid', itemId: 'invalid' } }, invalid, () => { throw new Error('validation bypassed'); });
  assert.equal(invalid.statusCode, 400);
});
