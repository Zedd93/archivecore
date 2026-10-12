import { OrderStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { createIntegrationSecret, hashIntegrationSecret, isIntegrationSecret } from './integration-key';

const safeKeySelect = {
  id: true,
  name: true,
  keyPrefix: true,
  createdAt: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
} as const;

const safeOrderSelect = {
  id: true,
  orderNumber: true,
  orderType: true,
  status: true,
  priority: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  _count: { select: { items: true } },
} as const;

export class IntegrationService {
  async listKeys(tenantId: string) {
    return prisma.integrationKey.findMany({
      where: { tenantId },
      select: safeKeySelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async createKey(tenantId: string, userId: string, name: string, expiresInDays: number, ipAddress?: string) {
    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, isActive: true }, select: { id: true } });
    if (!tenant) throw Object.assign(new Error('Aktywny tenant nie został znaleziony'), { statusCode: 404 });

    const { secret, keyHash, keyPrefix } = createIntegrationSecret();
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const key = await prisma.$transaction(async (tx) => {
      const created = await tx.integrationKey.create({
        data: { tenantId, createdById: userId, name, keyHash, keyPrefix, expiresAt },
        select: safeKeySelect,
      });
      await tx.auditLog.create({
        data: {
          tenantId, userId, action: 'integration.key.create', entityType: 'integration_key', entityId: created.id,
          newValues: { name, keyPrefix, expiresAt: expiresAt.toISOString() }, ipAddress,
        },
      });
      return created;
    });
    return { ...key, secret };
  }

  async revokeKey(tenantId: string, userId: string, id: string, ipAddress?: string) {
    const key = await prisma.$transaction(async (tx) => {
      const updated = await tx.integrationKey.updateMany({
        where: { id, tenantId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (updated.count !== 1) return null;
      const revoked = await tx.integrationKey.findUniqueOrThrow({ where: { id }, select: safeKeySelect });
      await tx.auditLog.create({
        data: {
          tenantId, userId, action: 'integration.key.revoke', entityType: 'integration_key', entityId: id,
          newValues: { name: revoked.name, keyPrefix: revoked.keyPrefix, revokedAt: revoked.revokedAt?.toISOString() }, ipAddress,
        },
      });
      return revoked;
    });
    if (!key) throw Object.assign(new Error('Aktywny klucz nie został znaleziony'), { statusCode: 404 });
    return key;
  }

  async authenticate(secret: string) {
    if (!isIntegrationSecret(secret)) return null;
    const now = new Date();
    const key = await prisma.integrationKey.findUnique({
      where: { keyHash: hashIntegrationSecret(secret) },
      select: { id: true, tenantId: true, expiresAt: true, revokedAt: true, tenant: { select: { isActive: true } } },
    });
    if (!key || key.revokedAt || key.expiresAt <= now || !key.tenant.isActive) return null;
    const updated = await prisma.integrationKey.updateMany({
      where: { id: key.id, revokedAt: null, expiresAt: { gt: now } },
      data: { lastUsedAt: now },
    });
    return updated.count === 1 ? key.tenantId : null;
  }

  async listOrders(tenantId: string, limit: number, status?: OrderStatus, cursor?: string) {
    if (cursor) {
      const exists = await prisma.order.findFirst({ where: { id: cursor, tenantId, ...(status ? { status } : {}) }, select: { id: true } });
      if (!exists) throw Object.assign(new Error('Nieprawidłowy kursor'), { statusCode: 400 });
    }
    const orders = await prisma.order.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      select: safeOrderSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = orders.length > limit;
    const page = orders.slice(0, limit);
    return {
      orders: page.map(({ _count, ...order }) => ({ ...order, itemCount: _count.items })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async getOrder(tenantId: string, id: string) {
    const order = await prisma.order.findFirst({ where: { id, tenantId }, select: safeOrderSelect });
    if (!order) throw Object.assign(new Error('Zlecenie nie zostało znalezione'), { statusCode: 404 });
    const { _count, ...data } = order;
    return { ...data, itemCount: _count.items };
  }
}

export const integrationService = new IntegrationService();
