import { OrderPriority, OrderType } from '@prisma/client';
import { SLA_LEVELS } from '@archivecore/shared';
import { prisma } from '../../config/database';

const orderTypes = Object.values(OrderType);
const priorities = Object.values(OrderPriority);

function defaultHours(priority: OrderPriority) {
  return SLA_LEVELS.find((level) => level.code === priority)?.hours ?? 48;
}

async function assertTenant(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) throw Object.assign(new Error('Tenant nie znaleziony'), { statusCode: 404 });
}

export class TenantSlaService {
  async list(tenantId: string) {
    await assertTenant(tenantId);
    const saved = await prisma.tenantSlaPolicy.findMany({ where: { tenantId } });
    const byKey = new Map(saved.map((policy) => [`${policy.orderType}:${policy.priority}`, policy.hours]));
    return orderTypes.flatMap((orderType) => priorities.map((priority) => ({
      orderType,
      priority,
      hours: byKey.get(`${orderType}:${priority}`) ?? defaultHours(priority),
      isCustom: byKey.has(`${orderType}:${priority}`),
    })));
  }

  async getHours(tenantId: string, orderType: OrderType, priority: OrderPriority) {
    const policy = await prisma.tenantSlaPolicy.findUnique({
      where: { tenantId_orderType_priority: { tenantId, orderType, priority } },
      select: { hours: true },
    });
    return policy?.hours ?? defaultHours(priority);
  }

  async updateTarget(tenantId: string, slaTargetPercent: number) {
    await assertTenant(tenantId);
    return prisma.tenant.update({ where: { id: tenantId }, data: { slaTargetPercent }, select: { id: true, slaTargetPercent: true } });
  }

  async replace(tenantId: string, policies: Array<{ orderType: OrderType; priority: OrderPriority; hours: number }>) {
    return prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
      if (!tenant) throw Object.assign(new Error('Tenant nie znaleziony'), { statusCode: 404 });
      await tx.tenantSlaPolicy.deleteMany({ where: { tenantId } });
      await tx.tenantSlaPolicy.createMany({ data: policies.map((policy) => ({ tenantId, ...policy })) });
      return policies;
    });
  }

  async reset(tenantId: string) {
    await assertTenant(tenantId);
    await prisma.tenantSlaPolicy.deleteMany({ where: { tenantId } });
    return this.list(tenantId);
  }
}

export const tenantSlaService = new TenantSlaService();
