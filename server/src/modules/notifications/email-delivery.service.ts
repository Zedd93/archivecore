import { PrismaClient } from '@prisma/client';
import { prisma } from '../../config/database';
import { returnReminderKind } from '../orders/order-return-reminder.service';
import { sendNotificationEmail, smtpSettings, SmtpSettings } from './email-transport';

type DueDelivery = {
  id: string;
  status: string;
  attempts: number;
  notification: {
    id: string;
    tenantId: string | null;
    type: string;
    title: string;
    message: string;
    entityId: string | null;
    user: { email: string; isActive: boolean; tenantId: string | null };
  };
};

const LOAN_STATUSES = ['delivered', 'completed'] as const;
export const EMAIL_DELIVERY_STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped'] as const;
export type EmailDeliveryStatus = typeof EMAIL_DELIVERY_STATUSES[number];

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

export function emailRetryDelayMs(attempts: number) {
  return [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000][Math.min(attempts - 1, 4)];
}

export class EmailDeliveryService {
  private running = false;

  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly getSettings: () => SmtpSettings | null = smtpSettings,
    private readonly send: typeof sendNotificationEmail = sendNotificationEmail,
  ) {}

  async listAdmin(page = 1, status?: EmailDeliveryStatus) {
    const limit = 20;
    const [items, total, counts] = await Promise.all([
      this.db.notificationEmailDelivery.findMany({
        where: status ? { status } : {},
        select: {
          id: true, status: true, attempts: true, lastError: true,
          createdAt: true, nextAttemptAt: true, sentAt: true,
          notification: {
            select: {
              title: true,
              user: { select: { email: true } },
              tenant: { select: { name: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.notificationEmailDelivery.count({ where: status ? { status } : {} }),
      this.db.notificationEmailDelivery.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return {
      smtpConfigured: this.getSettings() !== null,
      items: items.map((item) => ({
        id: item.id, status: item.status, attempts: item.attempts,
        lastError: item.lastError, createdAt: item.createdAt,
        nextAttemptAt: item.nextAttemptAt, sentAt: item.sentAt,
        title: item.notification.title,
        recipientEmail: item.notification.user.email,
        tenantName: item.notification.tenant?.name ?? null,
      })),
      total, page, limit,
      counts: Object.fromEntries(EMAIL_DELIVERY_STATUSES.map((key) => [
        key, counts.find((entry) => entry.status === key)?._count._all ?? 0,
      ])) as Record<EmailDeliveryStatus, number>,
    };
  }

  async retryFailed(id: string, actorId: string, now = new Date()) {
    if (!this.getSettings()) throw httpError('Poczta SMTP nie jest skonfigurowana', 409);
    return this.db.$transaction(async (tx) => {
      const delivery = await tx.notificationEmailDelivery.findUnique({
        where: { id },
        select: {
          status: true, attempts: true,
          notification: {
            select: {
              tenantId: true, type: true, entityId: true,
              user: { select: { tenantId: true, isActive: true } },
            },
          },
        },
      });
      if (!delivery) throw httpError('Wysyłka e-mail nie została znaleziona', 404);
      if (delivery.status !== 'failed') throw httpError('Ponowić można tylko nieudane wysyłki', 409);

      const notification = delivery.notification;
      const kind = notification.type === 'loan_return_upcoming' ? 'upcoming'
        : notification.type === 'loan_return_overdue' ? 'overdue' : null;
      const validRecipient = notification.user.isActive
        && (notification.user.tenantId === notification.tenantId || notification.user.tenantId === null);
      const order = kind && validRecipient && notification.entityId && notification.tenantId
        ? await tx.order.findFirst({
          where: {
            id: notification.entityId, tenantId: notification.tenantId,
            orderType: 'checkout', status: { in: [...LOAN_STATUSES] },
            items: { some: { itemStatus: 'delivered' } },
          },
          select: { expectedReturnAt: true },
        })
        : null;
      const stillRelevant = order?.expectedReturnAt
        && returnReminderKind(order.expectedReturnAt, now) === kind;
      const nextStatus = stillRelevant ? 'pending' : 'skipped';
      const updated = await tx.notificationEmailDelivery.updateMany({
        where: { id, status: 'failed' },
        data: {
          status: nextStatus, nextAttemptAt: now, leaseUntil: null,
          lastError: stillRelevant ? null : 'Przypomnienie nieaktualne',
        },
      });
      if (updated.count !== 1) throw httpError('Status wysyłki zmienił się. Odśwież listę.', 409);
      await tx.auditLog.create({
        data: {
          tenantId: notification.tenantId,
          userId: actorId,
          action: stillRelevant ? 'notification_email.retry' : 'notification_email.skip_stale',
          entityType: 'notification_email_delivery', entityId: id,
          oldValues: { status: 'failed', attempts: delivery.attempts },
          newValues: { status: nextStatus },
        },
      });
      return { status: nextStatus };
    });
  }

  async processDue(now = new Date()) {
    const settings = this.getSettings();
    if (!settings || this.running) return 0;
    this.running = true;
    try {
      const due = await this.db.notificationEmailDelivery.findMany({
        where: {
          OR: [
            { status: 'pending', nextAttemptAt: { lte: now } },
            { status: 'sending', leaseUntil: { lte: now } },
          ],
        },
        include: {
          notification: {
            select: {
              id: true, tenantId: true, type: true, title: true,
              message: true, entityId: true,
              user: { select: { email: true, isActive: true, tenantId: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });
      const results = await Promise.all(due.map((delivery) => this.processOne(delivery, settings, now)));
      return results.filter(Boolean).length;
    } finally {
      this.running = false;
    }
  }

  private async processOne(delivery: DueDelivery, settings: SmtpSettings, now: Date) {
    const attempts = delivery.attempts + 1;
    const claim = await this.db.notificationEmailDelivery.updateMany({
      where: {
        id: delivery.id,
        ...(delivery.status === 'pending'
          ? { status: 'pending', nextAttemptAt: { lte: now } }
          : { status: 'sending', leaseUntil: { lte: now } }),
      },
      data: { status: 'sending', attempts: { increment: 1 }, leaseUntil: new Date(now.getTime() + 120_000) },
    });
    if (claim.count !== 1) return false;

    const notification = delivery.notification;
    const kind = notification.type === 'loan_return_upcoming' ? 'upcoming'
      : notification.type === 'loan_return_overdue' ? 'overdue' : null;
    const validRecipient = notification.user.isActive
      && (notification.user.tenantId === notification.tenantId || notification.user.tenantId === null);
    const order = kind && validRecipient && notification.entityId && notification.tenantId
      ? await this.db.order.findFirst({
        where: {
          id: notification.entityId, tenantId: notification.tenantId,
          orderType: 'checkout', status: { in: [...LOAN_STATUSES] },
          items: { some: { itemStatus: 'delivered' } },
        },
        select: { expectedReturnAt: true },
      })
      : null;
    if (!order?.expectedReturnAt || returnReminderKind(order.expectedReturnAt, now) !== kind) {
      await this.db.notificationEmailDelivery.updateMany({
        where: { id: delivery.id, status: 'sending', attempts },
        data: { status: 'skipped', leaseUntil: null },
      });
      return false;
    }

    try {
      await this.send(settings, {
        id: notification.id,
        to: notification.user.email,
        subject: notification.title,
        body: notification.message,
        orderId: notification.entityId!,
      });
      await this.db.notificationEmailDelivery.updateMany({
        where: { id: delivery.id, status: 'sending', attempts },
        data: { status: 'sent', sentAt: new Date(), leaseUntil: null, lastError: null },
      });
      return true;
    } catch (error) {
      const responseCode = (error as { responseCode?: number }).responseCode;
      const permanent = typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600;
      await this.db.notificationEmailDelivery.updateMany({
        where: { id: delivery.id, status: 'sending', attempts },
        data: {
          status: permanent ? 'failed' : 'pending',
          nextAttemptAt: new Date(now.getTime() + emailRetryDelayMs(attempts)),
          leaseUntil: null,
          lastError: responseCode ? `SMTP ${responseCode}` : 'Połączenie z serwerem pocztowym nie powiodło się',
        },
      });
      if (attempts === 1 || permanent) {
        process.stderr.write(`Email delivery ${delivery.id}: ${permanent ? 'SMTP rejected message' : 'retry scheduled'}${responseCode ? ` (${responseCode})` : ''}\n`);
      }
      return false;
    }
  }
}

export const emailDeliveryService = new EmailDeliveryService();
