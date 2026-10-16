import { Prisma, PrismaClient } from '@prisma/client';
import { RoleCode } from '@archivecore/shared';
import { prisma } from '../../config/database';
import { notificationService } from '../notifications/notification.service';

const WINDOW_DAYS = 30;
const MIN_COMPLETED = 5;
const RECIPIENT_ROLES = [RoleCode.SUPER_ADMIN, RoleCode.DOXART_ADMIN, RoleCode.TENANT_LEADERSHIP, RoleCode.ADMIN_TENANT];

type SlaCountRow = { tenantId: string; completed: number; breached: number };

class NoAlertRecipientError extends Error {}

export class SlaTargetAlertService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async processDue(now = new Date()) {
    const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60_000);
    const [tenants, counts] = await Promise.all([
      this.db.tenant.findMany({ where: { isActive: true }, select: { id: true, name: true, slaTargetPercent: true } }),
      this.db.$queryRaw<SlaCountRow[]>(Prisma.sql`
        SELECT "tenantId", COUNT(*)::int AS "completed",
          COUNT(*) FILTER (WHERE "completedAt" > "slaDeadline")::int AS "breached"
        FROM "orders"
        WHERE "status" = 'completed' AND "slaDeadline" IS NOT NULL
          AND "completedAt" >= ${since} AND "completedAt" <= ${now}
        GROUP BY "tenantId"
      `),
    ]);
    const byTenant = new Map(counts.map((row) => [row.tenantId, row]));
    let notified = 0;

    for (const tenant of tenants) {
      const count = byTenant.get(tenant.id);
      const completed = count?.completed ?? 0;
      const breached = count?.breached ?? 0;
      const rate = completed ? Math.round((completed - breached) / completed * 100) : null;
      if (completed < MIN_COMPLETED || rate === null || rate >= tenant.slaTargetPercent) {
        await this.db.tenantSlaTargetAlertState.updateMany({
          where: { tenantId: tenant.id, isBelow: true },
          data: { isBelow: false },
        });
        continue;
      }

      try {
        if (await this.notifyBelow(tenant, rate, completed, now)) notified++;
      } catch (error) {
        if (error instanceof NoAlertRecipientError) continue;
        if ((error as { code?: string })?.code === 'P2002') continue;
        throw error;
      }
    }
    return notified;
  }

  private async notifyBelow(tenant: { id: string; name: string; slaTargetPercent: number }, rate: number, completed: number, now: Date) {
    return this.db.$transaction(async (tx) => {
      await tx.tenantSlaTargetAlertState.upsert({
        where: { tenantId: tenant.id },
        create: { tenantId: tenant.id },
        update: {},
      });
      const claimed = await tx.tenantSlaTargetAlertState.updateMany({
        where: { tenantId: tenant.id, isBelow: false },
        data: { isBelow: true, lastNotifiedAt: now },
      });
      if (claimed.count === 0) return false;

      const result = await notificationService.notifyTenantUsers({
        tenantId: tenant.id,
        type: 'tenant_sla_target_below',
        title: 'SLA poniżej celu',
        message: `${tenant.name}: w ostatnich ${WINDOW_DAYS} dniach terminowość SLA wyniosła ${rate}% przy celu ${tenant.slaTargetPercent}% (${completed} zakończonych zleceń).`,
        entityType: 'tenant',
        entityId: tenant.id,
        actionUrl: '/reports?slaDays=30&slaScope=all',
        requiredRoleCodes: RECIPIENT_ROLES,
      }, tx);
      if (result.count === 0) throw new NoAlertRecipientError();
      return true;
    }, { timeout: 10_000 });
  }
}

export const slaTargetAlertService = new SlaTargetAlertService();
