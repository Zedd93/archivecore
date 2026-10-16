import assert from 'node:assert/strict';
import test from 'node:test';

const { NotificationService } = await import('../src/modules/notifications/notification.service.ts');
const { EmailDeliveryService, emailRetryDelayMs } = await import('../src/modules/notifications/email-delivery.service.ts');
const { validSmtpSettings, smtpTransportOptions, notificationMailOptions } = await import('../src/modules/notifications/email-transport.ts');

const settings = {
  host: 'smtp.example.com', port: 587, secure: false,
  user: 'app@example.com', password: 'secret', from: 'ArchiveCore <app@example.com>',
  publicUrl: 'https://archivecore.example.com',
};

test('SMTP needs complete settings and an HTTPS application origin', () => {
  assert.equal(validSmtpSettings(settings), true);
  assert.equal(validSmtpSettings({ ...settings, password: '' }), false);
  assert.equal(validSmtpSettings({ ...settings, port: 0 }), false);
  assert.equal(validSmtpSettings({ ...settings, publicUrl: 'http://archivecore.example.com' }), false);
  assert.equal(validSmtpSettings({ ...settings, publicUrl: 'https://elsewhere.example.com/path' }), false);
});

test('loan notification and email job are queued together for each eligible recipient', async () => {
  const created = [];
  const db = {
    user: { findMany: async ({ where }) => {
      assert.equal(where.isActive, true);
      assert.deepEqual(where.OR, [{ tenantId: 'tenant-a' }, { id: { in: ['requester'] } }]);
      return [
        { id: 'requester', userRoles: [{ role: { code: 'TE' } }] },
        { id: 'lead', userRoles: [{ role: { code: 'TL' } }] },
        { id: 'employee', userRoles: [{ role: { code: 'TE' } }] },
      ];
    } },
    notification: { create: async ({ data }) => { created.push(data); } },
  };
  const service = new NotificationService(() => true);
  const result = await service.notifyTenantUsers({
    tenantId: 'tenant-a', type: 'loan_return_overdue', title: 'Termin', message: 'Zwrot',
    entityType: 'order', entityId: 'order-a', actionUrl: '/orders/order-a',
    requiredRoleCodes: ['TL', 'AT'], includeUserIds: ['requester'], includeGlobalUsers: false,
    queueEmail: true,
  }, db);
  assert.equal(result.count, 2);
  assert.deepEqual(created.map((entry) => entry.userId), ['requester', 'lead']);
  assert.ok(created.every((entry) => entry.emailDelivery && entry.tenantId === 'tenant-a'));
});

test('without SMTP only in-app notifications are created', async () => {
  let writes = 0;
  const service = new NotificationService(() => false);
  await service.notifyTenantUsers({
    tenantId: 'tenant-a', type: 'loan_return_upcoming', title: 'Termin', message: 'Zwrot',
    includeUserIds: ['requester'], onlyIncludedUsers: true, queueEmail: true,
  }, {
    user: { findMany: async () => [{ id: 'requester', userRoles: [] }] },
    notification: { createMany: async ({ data }) => { writes += data.length; return { count: data.length }; } },
  });
  assert.equal(writes, 1);
});

function workerSetup({ kind = 'overdue', dueAt = '2026-10-14T12:00:00Z', userTenantId = 'tenant-a' } = {}) {
  const now = new Date('2026-10-16T10:00:00Z');
  const delivery = {
    id: 'delivery-a', status: 'pending', attempts: 0, nextAttemptAt: now,
    notification: {
      id: 'notification-a', tenantId: 'tenant-a',
      type: `loan_return_${kind}`, title: 'Przypomnienie', message: 'Zwróć teczkę.',
      entityId: 'order-a',
      user: { email: 'user@example.com', isActive: true, tenantId: userTenantId },
    },
  };
  const sent = [];
  const updates = [];
  let active = true;
  let sendError = null;
  const db = {
    notificationEmailDelivery: {
      findMany: async ({ where, include }) => {
        assert.equal(where.OR[0].status, 'pending');
        assert.equal(include.notification.select.user.select.email, true);
        return (delivery.status === 'pending' && delivery.nextAttemptAt <= where.OR[0].nextAttemptAt.lte)
          || (delivery.status === 'sending' && delivery.leaseUntil <= where.OR[1].leaseUntil.lte)
          ? [delivery] : [];
      },
      updateMany: async ({ where, data }) => {
        if (delivery.status !== where.status) return { count: 0 };
        if (where.leaseUntil?.lte && delivery.leaseUntil > where.leaseUntil.lte) return { count: 0 };
        if (where.attempts !== undefined && delivery.attempts !== where.attempts) return { count: 0 };
        if (data.attempts?.increment) delivery.attempts += data.attempts.increment;
        const { attempts: _increment, ...fields } = data;
        Object.assign(delivery, fields);
        updates.push({ where, data });
        return { count: 1 };
      },
    },
    order: { findFirst: async ({ where }) => {
      assert.equal(where.id, 'order-a');
      assert.equal(where.tenantId, 'tenant-a');
      assert.deepEqual(where.items, { some: { itemStatus: 'delivered' } });
      return active ? { expectedReturnAt: new Date(dueAt) } : null;
    } },
  };
  const worker = new EmailDeliveryService(db, () => settings, async (_settings, message) => {
    sent.push(message);
    if (sendError) throw sendError;
  });
  return {
    worker, delivery, sent, updates, now,
    setActive: (value) => { active = value; },
    setSendError: (value) => { sendError = value; },
  };
}

test('email is sent once and linked to the right order', async () => {
  const state = workerSetup();
  assert.equal(await state.worker.processDue(state.now), 1);
  assert.equal(state.delivery.status, 'sent');
  assert.equal(state.delivery.attempts, 1);
  assert.equal(state.sent[0].to, 'user@example.com');
  assert.equal(state.sent[0].orderId, 'order-a');
  assert.equal(await state.worker.processDue(state.now), 0);
  assert.equal(state.sent.length, 1);
});

test('an expired sending lease can be recovered after a worker crash', async () => {
  const state = workerSetup();
  state.delivery.status = 'sending';
  state.delivery.attempts = 1;
  state.delivery.leaseUntil = new Date(state.now.getTime() - 1000);
  assert.equal(await state.worker.processDue(state.now), 1);
  assert.equal(state.delivery.status, 'sent');
  assert.equal(state.delivery.attempts, 2);
});

test('without SMTP configuration the worker does not touch the queue', async () => {
  const worker = new EmailDeliveryService({
    notificationEmailDelivery: { findMany: async () => { throw new Error('must not query'); } },
  }, () => null, async () => {});
  assert.equal(await worker.processDue(), 0);
});

test('temporary SMTP failure is retried from the queue', async () => {
  const state = workerSetup();
  state.setSendError(new Error('temporary network failure with private details'));
  assert.equal(await state.worker.processDue(state.now), 0);
  assert.equal(state.delivery.status, 'pending');
  assert.equal(state.delivery.lastError.includes('private details'), false);
  assert.equal(state.delivery.nextAttemptAt.getTime() - state.now.getTime(), 60_000);
  state.setSendError(null);
  assert.equal(await state.worker.processDue(new Date(state.now.getTime() + 60_000)), 1);
  assert.equal(state.delivery.status, 'sent');
  assert.equal(state.delivery.attempts, 2);
  assert.equal(emailRetryDelayMs(20), 21_600_000);
});

test('permanent SMTP rejection stops retrying', async () => {
  const state = workerSetup();
  state.setSendError(Object.assign(new Error('rejected'), { responseCode: 550 }));
  assert.equal(await state.worker.processDue(state.now), 0);
  assert.equal(state.delivery.status, 'failed');
  assert.equal(state.delivery.lastError, 'SMTP 550');
});

test('returned loan and stale upcoming notice are never emailed', async () => {
  const returned = workerSetup();
  returned.setActive(false);
  assert.equal(await returned.worker.processDue(returned.now), 0);
  assert.equal(returned.delivery.status, 'skipped');
  assert.equal(returned.sent.length, 0);

  const stale = workerSetup({ kind: 'upcoming', dueAt: '2026-10-16T12:00:00Z' });
  assert.equal(await stale.worker.processDue(stale.now), 0);
  assert.equal(stale.delivery.status, 'skipped');
  assert.equal(stale.sent.length, 0);
});

test('a recipient moved to another tenant is not emailed', async () => {
  const state = workerSetup({ userTenantId: 'tenant-b' });
  assert.equal(await state.worker.processDue(state.now), 0);
  assert.equal(state.delivery.status, 'skipped');
  assert.equal(state.sent.length, 0);
});

test('SMTP transport uses TLS, UTF-8 content, and a deterministic message id', async () => {
  const transportOptions = smtpTransportOptions(settings);
  const mail = notificationMailOptions(settings, {
    id: 'notification-a', to: 'user@example.com', subject: 'Zwrot teczki',
    body: 'Zwróć teczkę z aktami.', orderId: 'order-a',
  });
  assert.equal(transportOptions.requireTLS, true);
  assert.equal(transportOptions.auth.pass, 'secret');
  assert.equal(mail.subject, 'Zwrot teczki');
  assert.match(mail.text, /Zwróć teczkę z aktami/);
  assert.match(mail.text, /https:\/\/archivecore\.example\.com\/orders\/order-a/);
  assert.equal(mail.messageId, '<notification-a@archivecore.example.com>');
});
