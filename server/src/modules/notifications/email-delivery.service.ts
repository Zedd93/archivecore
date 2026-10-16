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
