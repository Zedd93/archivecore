import assert from 'node:assert/strict';
import test from 'node:test';

const { OrderReturnReminderService } = await import('../src/modules/orders/order-return-reminder.service.ts');
const { NotificationService } = await import('../src/modules/notifications/notification.service.ts');
const { EmailDeliveryService } = await import('../src/modules/notifications/email-delivery.service.ts');

const now = new Date('2026-10-16T10:00:00Z');
const dueAt = new Date('2026-10-17T12:00:00Z');
const orderId = '8a4b7d9a-89e2-4f5f-9c75-cf3f37e1543e';
const tenantId = 'tenant-doxart-test';
const recipientId = 'recipient-test';
const settings = {
  host: 'smtp.example.com', port: 587, secure: false,
  user: 'sender@example.com', password: 'test-only', from: 'ArchiveCore <sender@example.com>',
  publicUrl: 'https://archivecore.example.com',
};

function setup() {
  const reminders = new Set();
  const notifications = [];
  const deliveries = [];
  const sent = [];
  let loanActive = true;
  const order = () => ({
    id: orderId, tenantId, orderNumber: 'Z-TEST-0001', requestedBy: recipientId,
    requester: { tenantId }, expectedReturnAt: dueAt,
    returnReminders: [...reminders].map((kind) => ({ kind })),
  });

  const db = {
    $transaction: async (callback) => callback(db),
    $queryRaw: async () => [{ id: orderId }],
    order: {
      findMany: async () => loanActive && !reminders.has('upcoming') ? [order()] : [],
      findFirst: async () => loanActive ? order() : null,
    },
    custodyEvent: { findFirst: async () => null },
    orderReturnReminder: {
      create: async ({ data }) => {
        assert.equal(data.orderId, orderId);
        reminders.add(data.kind);
      },
    },
    user: {
      findMany: async ({ where }) => {
        assert.equal(where.isActive, true);
        assert.deepEqual(where.OR, [{ id: { in: [recipientId] } }]);
        return [{ id: recipientId, userRoles: [] }];
      },
    },
    notification: {
      create: async ({ data }) => {
        assert.equal(data.tenantId, tenantId);
        assert.ok(data.emailDelivery?.create);
        const notification = {
          id: `notification-${notifications.length + 1}`,
          ...data,
          user: { email: 'test@example.com', isActive: true, tenantId },
        };
        notifications.push(notification);
        deliveries.push({
          id: `delivery-${deliveries.length + 1}`, status: 'pending', attempts: 0,
          nextAttemptAt: now, notification,
        });
      },
    },
    notificationEmailDelivery: {
      findMany: async ({ where }) => {
        assert.equal(where.OR[0].status, 'pending');
        return deliveries.filter((delivery) => delivery.status === 'pending'
          && delivery.nextAttemptAt <= where.OR[0].nextAttemptAt.lte);
      },
      updateMany: async ({ where, data }) => {
        const delivery = deliveries.find((item) => item.id === where.id);
        if (!delivery || delivery.status !== where.status
          || (where.attempts !== undefined && delivery.attempts !== where.attempts)) {
          return { count: 0 };
        }
        if (data.attempts?.increment) delivery.attempts += data.attempts.increment;
        const { attempts: _increment, ...fields } = data;
        Object.assign(delivery, fields);
        return { count: 1 };
      },
    },
  };

  const notifier = new NotificationService(() => true);
  const remindersWorker = new OrderReturnReminderService(db, notifier);
  const emailWorker = new EmailDeliveryService(db, () => settings, async (_smtp, message) => {
    sent.push(message);
  });
  return {
    remindersWorker, emailWorker, reminders, notifications, deliveries, sent,
    returnLoan: () => { loanActive = false; },
  };
}

test('due loan creates one notification and one queued email, then sends once', async () => {
  const state = setup();
  assert.equal(await state.remindersWorker.processDue(now), 1);
  assert.equal(await state.remindersWorker.processDue(now), 0);
  assert.deepEqual([...state.reminders], ['upcoming']);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].type, 'loan_return_upcoming');
  assert.equal(state.notifications[0].actionUrl, `/orders/${orderId}`);
  assert.equal(state.deliveries.length, 1);

  assert.equal(await state.emailWorker.processDue(now), 1);
  assert.equal(state.deliveries[0].status, 'sent');
  assert.equal(state.deliveries[0].attempts, 1);
  assert.equal(state.sent[0].to, 'test@example.com');
  assert.equal(state.sent[0].orderId, orderId);
  assert.equal(await state.emailWorker.processDue(now), 0);
  assert.equal(state.sent.length, 1);
});

test('return before email processing skips the queued reminder', async () => {
  const state = setup();
  assert.equal(await state.remindersWorker.processDue(now), 1);
  state.returnLoan();
  assert.equal(await state.emailWorker.processDue(now), 0);
  assert.equal(state.deliveries[0].status, 'skipped');
  assert.equal(state.sent.length, 0);
});
