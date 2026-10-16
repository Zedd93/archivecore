import assert from 'node:assert/strict';
import test from 'node:test';
import audienceModule from '../src/modules/orders/order-notifications.ts';
import notificationModule from '../src/modules/notifications/notification.service.ts';

const { orderNotificationAudience, scanQuoteNotification } = audienceModule;
const { NotificationService } = notificationModule;

test('terminal decisions only target people linked to the order', () => {
  for (const status of ['completed', 'rejected', 'cancelled']) {
    assert.deepEqual(orderNotificationAudience(status), {
      requiredPermissions: [],
      onlyIncludedUsers: true,
    });
  }
});

test('submitted and approved orders still notify staff with the relevant permissions', () => {
  assert.equal(orderNotificationAudience('submitted').onlyIncludedUsers, false);
  assert.deepEqual(orderNotificationAudience('submitted').requiredPermissions, ['order.approve']);
  assert.deepEqual(orderNotificationAudience('approved').requiredPermissions, ['order.process']);
});

test('terminal notification writes only active order stakeholders in the same tenant', async () => {
  let query;
  let written;
  const db = {
    user: {
      findMany: async (args) => {
        query = args;
        return [
          { id: 'requester', userRoles: [{ role: { code: 'TE' } }] },
          { id: 'manager', userRoles: [{ role: { code: 'TL' } }] },
        ];
      },
    },
    notification: {
      createMany: async (args) => {
        written = args.data;
        return { count: args.data.length };
      },
    },
  };
  const result = await new NotificationService().notifyTenantUsers({
    tenantId: 'tenant-a',
    type: 'order_status',
    title: 'Rejected',
    message: 'Order rejected',
    includeUserIds: ['requester', 'manager'],
    excludeUserIds: ['manager'],
    ...orderNotificationAudience('rejected'),
  }, db);

  assert.equal(query.where.isActive, true);
  assert.deepEqual(query.where.OR, [{ id: { in: ['requester', 'manager'] } }]);
  assert.deepEqual(query.where.AND, [{ OR: [{ tenantId: 'tenant-a' }, { tenantId: null }] }]);
  assert.equal(result.count, 1);
  assert.deepEqual(written.map((item) => item.userId), ['requester']);
});

test('role-scoped escalation excludes users without the required role', async () => {
  let written;
  const db = {
    user: {
      findMany: async () => [
        { id: 'manager', userRoles: [{ role: { code: 'TL' } }] },
        { id: 'employee', userRoles: [{ role: { code: 'TE' } }] },
      ],
    },
    notification: {
      createMany: async ({ data }) => {
        written = data;
        return { count: data.length };
      },
    },
  };
  await new NotificationService().notifyTenantUsers({
    tenantId: 'tenant-a',
    type: 'order_sla_120',
    title: 'SLA',
    message: 'Overdue',
    requiredRoleCodes: ['TL', 'DA'],
  }, db);
  assert.deepEqual(written.map((item) => item.userId), ['manager']);
});

test('a ready scan quote notifies only client approvers, not global staff or employees', async () => {
  const order = { id: 'order-a', tenantId: 'tenant-a', orderNumber: 'Z-7', assignedTo: 'operator' };
  const input = scanQuoteNotification(order, 'ready', 'creator');
  assert.equal(input.actionUrl, '/orders/order-a');
  assert.equal(input.includeGlobalUsers, false);
  assert.deepEqual(input.requiredRoleCodes, ['TL', 'AT']);
  let query;
  let written;
  const db = {
    user: { findMany: async (args) => {
      query = args;
      return [
        { id: 'leader', userRoles: [{ role: { code: 'TL' } }] },
        { id: 'admin', userRoles: [{ role: { code: 'AT' } }] },
        { id: 'employee', userRoles: [{ role: { code: 'TE' } }] },
      ];
    } },
    notification: { createMany: async ({ data }) => { written = data; return { count: data.length }; } },
  };
  await new NotificationService().notifyTenantUsers(input, db);
  assert.deepEqual(query.where.OR, [{ tenantId: 'tenant-a' }]);
  assert.deepEqual(written.map((item) => item.userId), ['leader', 'admin']);
  assert.ok(written.every((item) => item.actionUrl === '/orders/order-a'));
});

test('an approved scan quote informs global archive staff and the assigned operator once', async () => {
  const order = { id: 'order-a', tenantId: 'tenant-a', orderNumber: 'Z-7', assignedTo: 'operator' };
  const input = scanQuoteNotification(order, 'approved', 'leader');
  assert.deepEqual(input.requiredRoleCodes, ['SA', 'DA', 'KA']);
  let query;
  let written;
  const db = {
    user: { findMany: async (args) => {
      query = args;
      return [
        { id: 'operator', userRoles: [{ role: { code: 'OM' } }] },
        { id: 'doxart', userRoles: [{ role: { code: 'DA' } }] },
        { id: 'leader', userRoles: [{ role: { code: 'TL' } }] },
        { id: 'employee', userRoles: [{ role: { code: 'TE' } }] },
      ];
    } },
    notification: { createMany: async ({ data }) => { written = data; return { count: data.length }; } },
  };
  await new NotificationService().notifyTenantUsers(input, db);
  assert.deepEqual(query.where.OR, [
    { tenantId: 'tenant-a' }, { tenantId: null }, { id: { in: ['operator'] } },
  ]);
  assert.deepEqual(written.map((item) => item.userId), ['operator', 'doxart']);
});
