import assert from 'node:assert/strict';
import test from 'node:test';

const { EmailDeliveryService } = await import('../src/modules/notifications/email-delivery.service.ts');
const { default: notificationRoutes } = await import('../src/modules/notifications/notification.routes.ts');

const settings = {
  host: 'smtp.example.com', port: 587, secure: false,
  user: 'app@example.com', password: 'secret', from: 'ArchiveCore <app@example.com>',
  publicUrl: 'https://archivecore.example.com',
};
const now = new Date('2026-10-16T10:00:00Z');

function setup({ status = 'failed', type = 'loan_return_overdue', dueAt = '2026-10-14T12:00:00Z',
  active = true, recipientTenantId = 'tenant-a', updated = 1 } = {}) {
  const writes = [];
  const delivery = {
    status, attempts: 2,
    notification: {
      tenantId: 'tenant-a', type, entityId: 'order-a',
      user: { tenantId: recipientTenantId, isActive: active },
    },
  };
  const db = {
    $transaction: async (fn) => fn(db),
    notificationEmailDelivery: {
      findUnique: async ({ where }) => {
        assert.equal(where.id, 'delivery-a');
        return delivery;
      },
      updateMany: async ({ where, data }) => {
        assert.deepEqual(where, { id: 'delivery-a', status: 'failed' });
        writes.push(data);
        return { count: updated };
      },
    },
    order: {
      findFirst: async ({ where }) => {
        assert.equal(where.id, 'order-a');
        assert.equal(where.tenantId, 'tenant-a');
        assert.deepEqual(where.items, { some: { itemStatus: 'delivered' } });
        return dueAt ? { expectedReturnAt: new Date(dueAt) } : null;
      },
    },
    auditLog: { create: async ({ data }) => writes.push(data) },
  };
  return { service: new EmailDeliveryService(db, () => settings), writes };
}

test('admin list is paginated and excludes notification bodies', async () => {
  const args = [];
  const db = {
    notificationEmailDelivery: {
      findMany: async (query) => {
        args.push(query);
        return [{
          id: 'delivery-a', status: 'failed', attempts: 2, lastError: 'SMTP 550',
          createdAt: now, nextAttemptAt: now, sentAt: null,
          notification: { title: 'Zwrot', user: { email: 'person@example.com' }, tenant: { name: 'Klient' } },
        }];
      },
      count: async () => 1,
      groupBy: async () => [{ status: 'failed', _count: { _all: 3 } }],
    },
  };
  const result = await new EmailDeliveryService(db, () => null).listAdmin(2, 'failed');
  assert.equal(args[0].skip, 20);
  assert.equal(args[0].take, 20);
  assert.deepEqual(args[0].where, { status: 'failed' });
  assert.equal(args[0].select.notification.select.message, undefined);
  assert.equal(result.smtpConfigured, false);
  assert.equal(result.counts.failed, 3);
  assert.equal(result.counts.sent, 0);
  assert.equal(result.items[0].recipientEmail, 'person@example.com');
  assert.equal(result.items[0].message, undefined);
});

test('failed and still-relevant email is queued again with an audit entry', async () => {
  const { service, writes } = setup();
  assert.deepEqual(await service.retryFailed('delivery-a', 'admin-a', now), { status: 'pending' });
  assert.equal(writes[0].status, 'pending');
  assert.equal(writes[0].lastError, null);
  assert.equal(writes[1].action, 'notification_email.retry');
  assert.equal(writes[1].userId, 'admin-a');
});

test('obsolete, returned, or cross-tenant reminders are skipped instead of sent', async () => {
  for (const options of [
    { dueAt: null },
    { dueAt: '2026-10-16T12:00:00Z', type: 'loan_return_upcoming' },
    { recipientTenantId: 'tenant-b' },
    { active: false },
  ]) {
    const { service, writes } = setup(options);
    assert.deepEqual(await service.retryFailed('delivery-a', 'admin-a', now), { status: 'skipped' });
    assert.equal(writes[0].status, 'skipped');
    assert.equal(writes[1].action, 'notification_email.skip_stale');
  }
});

test('retry rejects absent SMTP, non-failed status, and concurrent updates', async () => {
  const noSmtp = new EmailDeliveryService({}, () => null);
  await assert.rejects(noSmtp.retryFailed('delivery-a', 'admin-a', now), { statusCode: 409 });
  await assert.rejects(setup({ status: 'sent' }).service.retryFailed('delivery-a', 'admin-a', now), { statusCode: 409 });
  const raced = setup({ updated: 0 });
  await assert.rejects(raced.service.retryFailed('delivery-a', 'admin-a', now), { statusCode: 409 });
  assert.equal(raced.writes.length, 1);
});

test('retry returns not found without changing the queue', async () => {
  const db = {
    $transaction: async (fn) => fn(db),
    notificationEmailDelivery: { findUnique: async () => null },
  };
  const service = new EmailDeliveryService(db, () => settings);
  await assert.rejects(service.retryFailed('delivery-a', 'admin-a', now), { statusCode: 404 });
});

test('both email admin endpoints require a global administrator and validate inputs', () => {
  const routes = [
    notificationRoutes.stack.find((layer) => layer.route?.path === '/email-deliveries')?.route,
    notificationRoutes.stack.find((layer) => layer.route?.path === '/email-deliveries/:id/retry')?.route,
  ];
  for (const route of routes) {
    assert.ok(route);
    const roleGuard = route.stack[1].handle;
    const tenantGuard = route.stack[2].handle;
    const validate = route.stack[3].handle;
    const res = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
    const check = (guard, user) => {
      const response = res();
      let allowed = false;
      guard({ user }, response, () => { allowed = true; });
      return allowed ? 200 : response.statusCode;
    };
    assert.equal(check(roleGuard, { roles: ['TE'], tenantId: null }), 403);
    assert.equal(check(tenantGuard, { roles: ['SA'], tenantId: 'tenant-a' }), 403);
    assert.equal(check(roleGuard, { roles: ['DA'], tenantId: null }), 200);
    assert.equal(check(tenantGuard, { roles: ['DA'], tenantId: null }), 200);

    const response = res();
    const req = route.path === '/email-deliveries' ? { query: { page: '-1' } } : { params: { id: 'not-a-uuid' } };
    validate(req, response, () => { throw new Error('invalid input accepted'); });
    assert.equal(response.statusCode, 400);
  }
});
