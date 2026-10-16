import { OrderStatus, Prisma, PrismaClient } from '@prisma/client';
import { RoleCode } from '@archivecore/shared';
import { prisma } from '../../config/database';
import { notificationService } from '../notifications/notification.service';

type ReminderKind = 'upcoming' | 'overdue';
const ACTIVE_LOAN_STATUSES: OrderStatus[] = ['delivered', 'completed'];
const WARSAW_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
});

function dateKey(date: Date) {
  const parts = Object.fromEntries(WARSAW_DATE.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function returnReminderKind(dueAt: Date, now: Date): ReminderKind | null {
  const today = dateKey(now);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00.000Z`) + 24 * 60 * 60_000)
    .toISOString().slice(0, 10);
  const dueDay = dateKey(dueAt);
  if (dueDay === tomorrow) return 'upcoming';
  if (dueDay < today) return 'overdue';
  return null;
}

class NoReminderRecipientError extends Error {}

export class OrderReturnReminderService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly notifier: Pick<typeof notificationService, 'notifyTenantUsers'> = notificationService,
  ) {}

  async processDue(now = new Date()) {
    let cursor: string | undefined;
    let processed = 0;
    const horizon = new Date(now.getTime() + 48 * 60 * 60_000);

    for (;;) {
      const orders = await this.db.order.findMany({
        where: {
          orderType: 'checkout', status: { in: ACTIVE_LOAN_STATUSES },
          expectedReturnAt: { lte: horizon },
          items: { some: { itemStatus: 'delivered' } },
          OR: [
            { expectedReturnAt: { gte: new Date(now.getTime() - 48 * 60 * 60_000) }, returnReminders: { none: { kind: 'upcoming' } } },
            { returnReminders: { none: { kind: 'overdue' } } },
          ],
        },
        select: { id: true, expectedReturnAt: true, returnReminders: { select: { kind: true } } },
        orderBy: [{ expectedReturnAt: 'asc' }, { id: 'asc' }],
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      for (const order of orders) {
        if (!order.expectedReturnAt) continue;
        const kind = returnReminderKind(order.expectedReturnAt, now);
        if (!kind || order.returnReminders.some((reminder) => reminder.kind === kind)) continue;
        try {
          if (await this.remind(order.id, now)) processed++;
        } catch (error) {
          if (error instanceof NoReminderRecipientError) continue;
          if ((error as { code?: string })?.code === 'P2002') continue;
          throw error;
        }
      }

      if (orders.length < 100) break;
      cursor = orders[orders.length - 1].id;
    }
    return processed;
  }

  private async remind(orderId: string, now: Date) {
    return this.db.$transaction(async (tx) => {
      // Serializes reminder creation with manual returns, which lock the same order row.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`);
      const order = await tx.order.findFirst({
        where: {
          id: orderId, orderType: 'checkout', status: { in: ACTIVE_LOAN_STATUSES },
          items: { some: { itemStatus: 'delivered' } },
        },
        select: {
          id: true, tenantId: true, orderNumber: true, requestedBy: true,
          requester: { select: { tenantId: true } },
          expectedReturnAt: true, returnReminders: { select: { kind: true } },
        },
      });
      if (!order?.expectedReturnAt) return false;
      const kind = returnReminderKind(order.expectedReturnAt, now);
      if (!kind || order.returnReminders.some((reminder) => reminder.kind === kind)) return false;

      await tx.orderReturnReminder.create({ data: { orderId, kind } });
      const result = await this.notifier.notifyTenantUsers({
        tenantId: order.tenantId,
        type: kind === 'upcoming' ? 'loan_return_upcoming' : 'loan_return_overdue',
        title: kind === 'upcoming'
          ? `Jutro mija termin zwrotu ${order.orderNumber}`
          : `Minął termin zwrotu ${order.orderNumber}`,
        message: kind === 'upcoming'
          ? `Sprawdź wypożyczenie ${order.orderNumber} i zwróć pozostałe pozycje w terminie.`
          : `Wypożyczenie ${order.orderNumber} ma niewrócone pozycje. Sprawdź je i odnotuj zwrot.`,
        entityType: 'order', entityId: order.id, actionUrl: `/orders/${order.id}`,
        includeUserIds: order.requester.tenantId === order.tenantId || order.requester.tenantId === null
          ? [order.requestedBy] : [],
        ...(kind === 'upcoming'
          ? { onlyIncludedUsers: true }
          : { requiredRoleCodes: [RoleCode.TENANT_LEADERSHIP, RoleCode.ADMIN_TENANT], includeGlobalUsers: false }),
      }, tx);
      if (result.count === 0) throw new NoReminderRecipientError();
      return true;
    }, { timeout: 10_000 });
  }
}

export const orderReturnReminderService = new OrderReturnReminderService();
