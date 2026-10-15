import assert from 'node:assert/strict';
import test from 'node:test';
import audienceModule from '../src/modules/orders/order-notifications.ts';
import notificationModule from '../src/modules/notifications/notification.service.ts';

const { orderNotificationAudience } = audienceModule;
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
