import { randomBytes, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { decryptAES256, encryptAES256 } from '../../utils/crypto';
import { sendWebhook, validateWebhookUrl } from './webhook-transport';

const endpointSelect = {
  id: true, name: true, url: true, isActive: true, createdAt: true, updatedAt: true,
} as const;

export function retryDelayMs(attempts: number) {
  return [60_000, 300_000, 1_800_000, 7_200_000][Math.min(attempts - 1, 3)];
}

export class WebhookService {
  private running = false;

  async listEndpoints(tenantId: string) {
    return prisma.webhookEndpoint.findMany({
      where: { tenantId }, select: endpointSelect, orderBy: { createdAt: 'desc' },
    });
  }

  async listDeliveries(tenantId: string) {
    return prisma.webhookDelivery.findMany({
      where: { endpoint: { tenantId } },
      select: {
        id: true, eventId: true, status: true, attempts: true, nextAttemptAt: true,
        lastError: true, createdAt: true, deliveredAt: true,
        endpoint: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async createEndpoint(tenantId: string, userId: string, name: string, inputUrl: string, ipAddress?: string) {
    let url: string;
    try { url = validateWebhookUrl(inputUrl); }
    catch (error) { throw Object.assign(error as Error, { statusCode: 400 }); }
    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, isActive: true }, select: { id: true } });
    if (!tenant) throw Object.assign(new Error('Aktywny tenant nie został znaleziony'), { statusCode: 404 });
    const secret = `whsec_${randomBytes(32).toString('hex')}`;
    const endpoint = await prisma.$transaction(async (tx) => {
      const created = await tx.webhookEndpoint.create({
        data: { tenantId, createdById: userId, name, url, secretEncrypted: encryptAES256(secret) },
        select: endpointSelect,
      });
      await tx.auditLog.create({
        data: {
          tenantId, userId, action: 'integration.webhook.create', entityType: 'webhook_endpoint',
          entityId: created.id, newValues: { name, hostname: new URL(url).hostname }, ipAddress,
        },
      });
      return created;
    });
    return { ...endpoint, secret };
  }

  async deactivateEndpoint(tenantId: string, userId: string, id: string, ipAddress?: string) {
    const endpoint = await prisma.$transaction(async (tx) => {
      const updated = await tx.webhookEndpoint.updateMany({ where: { id, tenantId, isActive: true }, data: { isActive: false } });
      if (updated.count !== 1) return null;
      const disabled = await tx.webhookEndpoint.findUniqueOrThrow({ where: { id }, select: endpointSelect });
      await tx.auditLog.create({
        data: {
          tenantId, userId, action: 'integration.webhook.deactivate', entityType: 'webhook_endpoint',
          entityId: id, newValues: { name: disabled.name, isActive: false }, ipAddress,
        },
      });
      return disabled;
    });
    if (!endpoint) throw Object.assign(new Error('Aktywny webhook nie został znaleziony'), { statusCode: 404 });
    return endpoint;
  }

  async enqueueOrderStatus(
    tx: Prisma.TransactionClient,
    order: { id: string; tenantId: string; orderNumber: string; orderType: string },
    previousStatus: string,
    status: string,
  ) {
    const endpoints = await tx.webhookEndpoint.findMany({
      where: { tenantId: order.tenantId, isActive: true }, select: { id: true },
    });
    if (endpoints.length === 0) return;
    const eventId = randomUUID();
    const payloadText = JSON.stringify({
      id: eventId,
      type: 'order.status_changed',
      occurredAt: new Date().toISOString(),
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        previousStatus,
        status,
      },
    });
    await tx.webhookDelivery.createMany({
      data: endpoints.map((endpoint) => ({ endpointId: endpoint.id, eventId, payloadText })),
      skipDuplicates: true,
    });
  }

  async processDue() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const due = await prisma.webhookDelivery.findMany({
        where: {
          OR: [
            { status: 'pending', nextAttemptAt: { lte: now } },
            { status: 'sending', leaseUntil: { lte: now } },
          ],
        },
        include: { endpoint: { select: { url: true, secretEncrypted: true, isActive: true } } },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });
      await Promise.all(due.map((delivery) => this.processOne(delivery, now)));
    } finally {
      this.running = false;
    }
  }

  private async processOne(delivery: Awaited<ReturnType<typeof prisma.webhookDelivery.findMany>>[number] & {
    endpoint: { url: string; secretEncrypted: string; isActive: boolean };
  }, now: Date) {
    const claim = await prisma.webhookDelivery.updateMany({
      where: {
        id: delivery.id,
        ...(delivery.status === 'pending'
          ? { status: 'pending', nextAttemptAt: { lte: now } }
          : { status: 'sending', leaseUntil: { lte: now } }),
      },
      data: { status: 'sending', attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + 30_000) },
    });
    if (claim.count !== 1) return;

    const attempts = delivery.attempts + 1;
    try {
      if (!delivery.endpoint.isActive) throw new Error('Endpoint disabled');
      await sendWebhook(
        delivery.endpoint.url, decryptAES256(delivery.endpoint.secretEncrypted),
        delivery.eventId, delivery.payloadText,
      );
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'delivered', deliveredAt: new Date(), leaseUntil: null, lastError: null },
      });
    } catch (error) {
      const message = (error as Error).message;
      const lastError = /^HTTP \d{3}$/.test(message) ? message
        : message === 'Endpoint disabled' ? 'Webhook wyłączony'
          : 'Nie udało się połączyć z publicznym adresem HTTPS';
      const failed = attempts >= 5 || !delivery.endpoint.isActive;
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: failed ? 'failed' : 'pending',
          nextAttemptAt: failed ? new Date() : new Date(Date.now() + retryDelayMs(attempts)),
          leaseUntil: null,
          lastError,
        },
      });
    }
  }
}

export const webhookService = new WebhookService();
