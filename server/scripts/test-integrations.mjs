import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prisma } = require('../dist/config/database.js');
const { IntegrationService } = require('../dist/modules/integrations/integration.service.js');
const { createIntegrationSecret, hashIntegrationSecret, isIntegrationSecret } = require('../dist/modules/integrations/integration-key.js');

test('integration keys have high entropy and only their hashes need storage', () => {
  const first = createIntegrationSecret();
  const second = createIntegrationSecret();
  assert.match(first.secret, /^ac_live_[a-f0-9]{64}$/);
  assert.equal(isIntegrationSecret(first.secret), true);
  assert.equal(isIntegrationSecret('ac_live_short'), false);
  assert.equal(first.keyHash, hashIntegrationSecret(first.secret));
  assert.notEqual(first.secret, second.secret);
  assert.notEqual(first.keyHash, second.keyHash);
  assert.equal(first.keyHash.includes(first.secret), false);
});

test('expired and revoked keys never authenticate', async () => {
  const secret = createIntegrationSecret().secret;
  const originalFind = prisma.integrationKey.findUnique;
  const originalUpdate = prisma.integrationKey.updateMany;
  let updated = 0;
  prisma.integrationKey.updateMany = async () => { updated++; return { count: 1 }; };
  try {
    for (const overrides of [
      { revokedAt: new Date() },
      { expiresAt: new Date(Date.now() - 1000) },
      { tenant: { isActive: false } },
    ]) {
      prisma.integrationKey.findUnique = async () => ({
        id: 'key-id', tenantId: 'tenant-a', expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null, tenant: { isActive: true }, ...overrides,
      });
      assert.equal(await new IntegrationService().authenticate(secret), null);
    }
    assert.equal(updated, 0);
  } finally {
    prisma.integrationKey.findUnique = originalFind;
    prisma.integrationKey.updateMany = originalUpdate;
  }
});

test('order API always scopes by tenant and returns a minimal response', async () => {
  const originalFindMany = prisma.order.findMany;
  const originalFindFirst = prisma.order.findFirst;
  let where;
  const order = {
    id: 'order-a', orderNumber: 'Z-1', orderType: 'checkout', status: 'submitted',
    priority: 'normal', createdAt: new Date(), updatedAt: new Date(), completedAt: null,
    _count: { items: 2 },
  };
  prisma.order.findMany = async (args) => { where = args.where; return [order]; };
  prisma.order.findFirst = async (args) => { where = args.where; return args.where.tenantId === 'tenant-a' ? order : null; };
  try {
    const service = new IntegrationService();
    const page = await service.listOrders('tenant-a', 10, 'submitted');
    assert.deepEqual(where, { tenantId: 'tenant-a', status: 'submitted' });
    assert.equal(page.orders[0].itemCount, 2);
    assert.equal('location' in page.orders[0], false);
    assert.equal('_count' in page.orders[0], false);
    assert.equal(page.nextCursor, null);
    await assert.rejects(service.getOrder('tenant-b', 'order-a'), { statusCode: 404 });
    assert.deepEqual(where, { id: 'order-a', tenantId: 'tenant-b' });
  } finally {
    prisma.order.findMany = originalFindMany;
    prisma.order.findFirst = originalFindFirst;
  }
});

test('key management list is scoped to the selected tenant', async () => {
  const original = prisma.integrationKey.findMany;
  let where;
  prisma.integrationKey.findMany = async (args) => { where = args.where; return []; };
  try {
    await new IntegrationService().listKeys('tenant-a');
    assert.deepEqual(where, { tenantId: 'tenant-a' });
  } finally {
    prisma.integrationKey.findMany = original;
  }
});

test('key creation and revocation are tenant-scoped and audit metadata never includes the secret', async () => {
  const originalFindTenant = prisma.tenant.findFirst;
  const originalTransaction = prisma.$transaction;
  let createdData;
  let revokedWhere;
  const auditEvents = [];
  prisma.tenant.findFirst = async ({ where }) => where.id === 'tenant-a' && where.isActive ? { id: 'tenant-a' } : null;
  prisma.$transaction = async (callback) => callback({
    integrationKey: {
      create: async ({ data }) => {
        createdData = data;
        return { id: 'key-id', name: data.name, keyPrefix: data.keyPrefix, expiresAt: data.expiresAt };
      },
      updateMany: async ({ where }) => { revokedWhere = where; return { count: 1 }; },
      findUniqueOrThrow: async () => ({ id: 'key-id', name: 'ERP', keyPrefix: 'ac_live_...', revokedAt: new Date() }),
    },
    auditLog: { create: async ({ data }) => { auditEvents.push(data); return data; } },
  });
  try {
    const service = new IntegrationService();
    const result = await service.createKey('tenant-a', 'user-a', 'ERP', 30);
    assert.equal(result.secret.startsWith('ac_live_'), true);
    assert.equal(createdData.tenantId, 'tenant-a');
    assert.equal(createdData.keyHash, hashIntegrationSecret(result.secret));
    assert.equal(JSON.stringify(auditEvents).includes(result.secret), false);
    await service.revokeKey('tenant-a', 'user-a', 'key-id');
    assert.deepEqual(revokedWhere, { id: 'key-id', tenantId: 'tenant-a', revokedAt: null });
  } finally {
    prisma.tenant.findFirst = originalFindTenant;
    prisma.$transaction = originalTransaction;
  }
});
