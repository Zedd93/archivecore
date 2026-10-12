import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';

const require = createRequire(import.meta.url);
const { prisma } = require('../dist/config/database.js');
const { validateWebhookUrl, isPublicIpv4, signWebhook } = require('../dist/modules/integrations/webhook-transport.js');
const { WebhookService, retryDelayMs } = require('../dist/modules/integrations/webhook.service.js');
const { OrderService } = require('../dist/modules/orders/order.service.js');

test('webhook URL checks reject internal targets and non-HTTPS destinations', () => {
  assert.equal(validateWebhookUrl('https://example.com/hooks/one'), 'https://example.com/hooks/one');
  for (const url of [
    'http://example.com/hook', 'https://localhost/hook', 'https://127.0.0.1/hook',
    'https://[::1]/hook', 'https://example.local/hook', 'https://example.com:8443/hook',
    'https://user:pass@example.com/hook', 'https://example.com/hook#fragment',
  ]) assert.throws(() => validateWebhookUrl(url));
  for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.2', '100.64.0.1', '203.0.113.2']) {
    assert.equal(isPublicIpv4(ip), false, ip);
  }
  assert.equal(isPublicIpv4('1.1.1.1'), true);
  assert.equal(isPublicIpv4('8.8.8.8'), true);
});

test('webhook signature binds timestamp and exact payload bytes', () => {
  const payload = '{"id":"event-1"}';
  const expected = createHmac('sha256', 'secret').update(`1234.${payload}`).digest('hex');
  assert.equal(signWebhook('secret', '1234', payload), `sha256=${expected}`);
  assert.notEqual(signWebhook('secret', '1235', payload), `sha256=${expected}`);
  assert.notEqual(signWebhook('secret', '1234', '{}'), `sha256=${expected}`);
});

test('status event is tenant-scoped, minimal and queued once per active recipient', async () => {
  const service = new WebhookService();
  let where;
  let created;
  await service.enqueueOrderStatus({
    webhookEndpoint: { findMany: async (args) => { where = args.where; return [{ id: 'endpoint-a' }, { id: 'endpoint-b' }]; } },
    webhookDelivery: { createMany: async (args) => { created = args; return { count: 2 }; } },
  }, { id: 'order-1', tenantId: 'tenant-a', orderNumber: 'Z-1', orderType: 'checkout', notes: 'secret note', locationId: 'hidden' }, 'ready', 'delivered');
  assert.deepEqual(where, { tenantId: 'tenant-a', isActive: true });
  assert.equal(created.data.length, 2);
  assert.equal(created.data[0].eventId, created.data[1].eventId);
  const payload = JSON.parse(created.data[0].payloadText);
  assert.equal(payload.type, 'order.status_changed');
  assert.deepEqual(payload.data, { orderId: 'order-1', orderNumber: 'Z-1', orderType: 'checkout', previousStatus: 'ready', status: 'delivered' });
  assert.equal(created.data[0].payloadText.includes('secret note'), false);
  assert.equal(created.data[0].payloadText.includes('hidden'), false);
});

test('new webhook secret is only returned once and omitted from audit metadata', async () => {
  const originalFindTenant = prisma.tenant.findFirst;
  const originalTransaction = prisma.$transaction;
  let stored;
  let audit;
  prisma.tenant.findFirst = async () => ({ id: 'tenant-a' });
  prisma.$transaction = async (callback) => callback({
    webhookEndpoint: { create: async ({ data }) => { stored = data; return { id: 'endpoint-a', name: data.name, url: data.url }; } },
    auditLog: { create: async ({ data }) => { audit = data; return data; } },
  });
  try {
    const result = await new WebhookService().createEndpoint('tenant-a', 'user-a', 'ERP', 'https://example.com/hook');
    assert.match(result.secret, /^whsec_[a-f0-9]{64}$/);
    assert.equal(stored.tenantId, 'tenant-a');
    assert.equal(stored.secretEncrypted.includes(result.secret), false);
    assert.equal(JSON.stringify(audit).includes(result.secret), false);
    assert.equal(audit.newValues.hostname, 'example.com');
  } finally {
    prisma.tenant.findFirst = originalFindTenant;
    prisma.$transaction = originalTransaction;
  }
});

test('ordinary status transitions store webhook events in the order transaction', async () => {
  const originalTransaction = prisma.$transaction;
  const service = new OrderService();
  const order = { id: 'order-1', tenantId: 'tenant-a', orderNumber: 'Z-1', orderType: 'checkout', status: 'draft', requestedBy: 'user-a', items: [] };
  service.getById = async () => order;
  service.notifyOrderStatus = async () => undefined;
  let queued;
  prisma.$transaction = async (callback) => callback({
    order: { update: async () => ({ ...order, status: 'submitted' }) },
    webhookEndpoint: { findMany: async () => [{ id: 'endpoint-a' }] },
    webhookDelivery: { createMany: async (args) => { queued = args; return { count: 1 }; } },
  });
  try {
    await service.updateStatus('order-1', 'tenant-a', 'submitted', 'user-a');
    assert.equal(JSON.parse(queued.data[0].payloadText).data.status, 'submitted');
  } finally {
    prisma.$transaction = originalTransaction;
  }
});

test('disabled recipient is not contacted and retry schedule is bounded', async () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(retryDelayMs), [60_000, 300_000, 1_800_000, 7_200_000, 7_200_000]);
  const originalFind = prisma.webhookDelivery.findMany;
  const originalClaim = prisma.webhookDelivery.updateMany;
  const originalUpdate = prisma.webhookDelivery.update;
  let finalStatus;
  prisma.webhookDelivery.findMany = async () => [{
    id: 'delivery-a', eventId: 'event-a', status: 'pending', attempts: 0,
    payloadText: '{}', endpoint: { isActive: false, url: 'https://example.com/hook', secretEncrypted: 'unused' },
  }];
  prisma.webhookDelivery.updateMany = async () => ({ count: 1 });
  prisma.webhookDelivery.update = async ({ data }) => { finalStatus = data.status; return data; };
  try {
    await new WebhookService().processDue();
    assert.equal(finalStatus, 'failed');
  } finally {
    prisma.webhookDelivery.findMany = originalFind;
    prisma.webhookDelivery.updateMany = originalClaim;
    prisma.webhookDelivery.update = originalUpdate;
  }
});
