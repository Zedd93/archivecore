import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';

export class RetentionService {
  async listPolicies(tenantId: string) {
    return prisma.retentionPolicy.findMany({
      where: { OR: [{ tenantId }, { tenantId: null }] },
      include: {
        rules: true,
        _count: { select: { boxes: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getPolicy(id: string, tenantId: string) {
    const policy = await prisma.retentionPolicy.findFirst({
      where: { id, OR: [{ tenantId }, { tenantId: null }] },
      include: { rules: true, _count: { select: { boxes: true } } },
    });
    if (!policy) throw Object.assign(new Error('Polityka retencji nie znaleziona'), { statusCode: 404 });
    return policy;
  }

  async createPolicy(tenantId: string, data: any) {
    return prisma.retentionPolicy.create({
      data: {
        tenantId,
        name: data.name,
        docType: data.docType,
        retentionYears: data.retentionYears,
        retentionTrigger: data.retentionTrigger || 'creation_date',
        description: data.description,
        isActive: data.isActive ?? true,
        rules: data.rules ? {
          create: data.rules.map((rule: any) => ({
            conditionField: rule.conditionField,
            conditionOperator: rule.conditionOperator,
            conditionValue: rule.conditionValue,
            action: rule.action || 'review',
            notifyBeforeDays: rule.notifyBeforeDays || 30,
          })),
        } : undefined,
      },
      include: { rules: true },
    });
  }

  async updatePolicy(id: string, tenantId: string, data: any) {
    await this.getPolicy(id, tenantId);
    return prisma.retentionPolicy.update({
      where: { id },
      data: {
        name: data.name,
        docType: data.docType,
        retentionYears: data.retentionYears,
        retentionTrigger: data.retentionTrigger,
        description: data.description,
        isActive: data.isActive,
      },
      include: { rules: true },
    });
  }

  async deletePolicy(id: string, tenantId: string) {
    const policy = await this.getPolicy(id, tenantId);
    if (policy._count.boxes > 0) {
      throw Object.assign(
        new Error('Nie można usunąć polityki — przypisane kartony'),
        { statusCode: 400 }
      );
    }
    await prisma.retentionRule.deleteMany({ where: { policyId: id } });
    await prisma.retentionPolicy.delete({ where: { id } });
    return { deleted: true };
  }

  // Calculate and update retention dates for boxes with a specific policy
  async recalculateForPolicy(policyId: string, tenantId: string) {
    const policy = await this.getPolicy(policyId, tenantId);
    const boxes = await prisma.box.findMany({
      where: { retentionPolicyId: policyId },
    });

    let updated = 0;
    for (const box of boxes) {
      let baseDate: Date | null = null;
      switch (policy.retentionTrigger) {
        case 'creation_date':
          baseDate = box.createdAt;
          break;
        case 'end_date':
          baseDate = box.dateTo;
          break;
        default:
          baseDate = box.createdAt;
      }

      if (baseDate) {
        const retentionDate = new Date(baseDate);
        retentionDate.setFullYear(retentionDate.getFullYear() + policy.retentionYears);

        await prisma.box.update({
          where: { id: box.id },
          data: { retentionDate },
        });
        updated++;
      }
    }

    return { policyId, boxesUpdated: updated };
  }

  // Get boxes approaching retention date
  async getBoxesForReview(tenantId: string, daysAhead: number = 90) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    return prisma.box.findMany({
      where: {
        tenantId,
        retentionDate: { lte: futureDate, gte: new Date() },
        status: { in: ['active', 'checked_out'] },
      },
      orderBy: { retentionDate: 'asc' },
      include: {
        location: { select: { fullPath: true } },
        retentionPolicy: { select: { name: true, retentionYears: true } },
      },
    });
  }

  // Initiate disposal process
  async initiateDisposal(tenantId: string, boxIds: string[], notes?: string) {
    const updated = await prisma.box.updateMany({
      where: {
        id: { in: boxIds },
        tenantId,
        status: 'active',
      },
      data: {
        status: 'pending_disposal',
        notes: notes || undefined,
      },
    });

    return { count: updated.count, boxIds };
  }

  // Approve disposal
  async approveDisposal(tenantId: string, boxIds: string[]) {
    const updated = await prisma.box.updateMany({
      where: {
        id: { in: boxIds },
        tenantId,
        status: 'pending_disposal',
      },
      data: {
        status: 'disposed',
        disposalDate: new Date(),
      },
    });

    // Update location counters
    for (const boxId of boxIds) {
      const box = await prisma.box.findUnique({ where: { id: boxId }, select: { locationId: true } });
      if (box?.locationId) {
        await prisma.location.update({
          where: { id: box.locationId },
          data: { currentCount: { decrement: 1 } },
        });
      }
    }

    return { count: updated.count };
  }
}

export const retentionService = new RetentionService();
