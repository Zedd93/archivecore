import { PrismaClient, OrderStatus } from '@prisma/client';
import { RoleCode } from '@archivecore/shared';
import { prisma } from '../../config/database';
import { notificationService } from '../notifications/notification.service';
import { ACTIVE_SLA_STATUSES, slaEscalationLevel, SlaEscalationLevel } from './order-sla';

const ACTIVE_STATUSES: OrderStatus[] = [...ACTIVE_SLA_STATUSES];

const ESCALATION_ROLES: Record<SlaEscalationLevel, RoleCode[]> = {
  80: [RoleCode.OPERATOR_WAREHOUSE, RoleCode.COORDINATOR_ARCHIVE, RoleCode.DOXART_ADMIN],
  100: [RoleCode.COORDINATOR_ARCHIVE, RoleCode.DOXART_ADMIN, RoleCode.TENANT_LEADERSHIP, RoleCode.ADMIN_TENANT],
  120: [RoleCode.SUPER_ADMIN, RoleCode.DOXART_ADMIN, RoleCode.TENANT_LEADERSHIP, RoleCode.ADMIN_TENANT],
};

class NoEscalationRecipientError extends Error {}

export class OrderSlaService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async processDue(now = new Date()) {
    let cursor: string | undefined;
    let processed = 0;
    const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60_000);

    for (;;) {
      const orders = await this.db.order.findMany({
        where: {
          status: { in: ACTIVE_STATUSES },
          slaDeadline: { lte: horizon },
          slaEscalations: { none: { level: 120 } },
        },
        select: { id: true, priority: true, slaDeadline: true, slaEscalations: { select: { level: true } } },
        orderBy: [{ slaDeadline: 'asc' }, { id: 'asc' }],
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      for (const order of orders) {
        if (!order.slaDeadline) continue;
        if (order.slaEscalations.some((event) => event.level === 120)) continue;
        const level = slaEscalationLevel(order.slaDeadline, order.priority, now);
        if (!level || order.slaEscalations.some((event) => event.level >= level)) continue;
        try {
          if (await this.escalate(order.id, now)) processed++;
        } catch (error) {
          if (error instanceof NoEscalationRecipientError) continue;
          if ((error as { code?: string })?.code === 'P2002') continue;
          throw error;
        }
      }

      if (orders.length < 100) break;
      cursor = orders[orders.length - 1].id;
    }
    return processed;
  }

  private async escalate(orderId: string, now: Date) {
    return this.db.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, status: { in: ACTIVE_STATUSES } },
        select: {
          id: true, tenantId: true, orderNumber: true, priority: true,
          slaDeadline: true, assignedTo: true,
          slaEscalations: { select: { level: true } },
        },
      });
      if (!order?.slaDeadline) return false;
      const level = slaEscalationLevel(order.slaDeadline, order.priority, now);
      if (!level || order.slaEscalations.some((event) => event.level >= level)) return false;

      await tx.orderSlaEscalation.create({ data: { orderId, level } });
      const payload = {
        tenantId: order.tenantId,
        type: `order_sla_${level}`,
        title: `SLA ${level}%: zlecenie ${order.orderNumber}`,
        message: level === 80
          ? `Zlecenie ${order.orderNumber} zbliża się do terminu realizacji.`
          : level === 100
            ? `Zlecenie ${order.orderNumber} osiągnęło termin SLA.`
            : `Zlecenie ${order.orderNumber} przekroczyło termin SLA o 20% czasu roboczego.`,
        entityType: 'order',
        entityId: orderId,
        actionUrl: `/orders/${orderId}`,
      };

      let result = { count: 0 };
      if (level === 80 && order.assignedTo) {
        result = await notificationService.notifyTenantUsers({
          ...payload, onlyIncludedUsers: true, includeUserIds: [order.assignedTo],
        }, tx);
      }
      if (result.count === 0) {
        result = await notificationService.notifyTenantUsers({
          ...payload, requiredRoleCodes: ESCALATION_ROLES[level],
        }, tx);
      }
      if (result.count === 0) throw new NoEscalationRecipientError();
      return true;
    }, { timeout: 10_000 });
  }
}

export const orderSlaService = new OrderSlaService();
