import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';
import { IJwtPayload, Permissions, RoleCode } from '@archivecore/shared';
import { notificationService } from '../notifications/notification.service';
import { parseJrwaDocx } from './jrwa-import.parser';

export class RetentionService {
  private isSuperAdmin(actor?: IJwtPayload) {
    return Boolean(actor?.roles.includes(RoleCode.SUPER_ADMIN));
  }

  private assertCanManageGlobalPolicy(actor: IJwtPayload) {
    if (!this.isSuperAdmin(actor)) {
      throw Object.assign(
        new Error('Tylko Super Admin może zarządzać globalnymi politykami retencji'),
        { statusCode: 403 }
      );
    }
  }

  async listPolicies(tenantId: string | null, actor?: IJwtPayload, requestedTenantId?: string) {
    if (requestedTenantId && !this.isSuperAdmin(actor) && requestedTenantId !== tenantId) {
      throw Object.assign(new Error('Nie masz dostępu do polityk retencji tego tenanta'), { statusCode: 403 });
    }
    const effectiveTenantId = requestedTenantId || tenantId;
    const where: Prisma.RetentionPolicyWhereInput = effectiveTenantId
      ? { OR: [{ tenantId: effectiveTenantId }, { tenantId: null }] }
      : { tenantId: null };

    const policies = await prisma.retentionPolicy.findMany({
      where,
      include: {
        rules: true,
        tenant: { select: { id: true, name: true, shortCode: true } },
        _count: { select: { boxes: true } },
      },
      orderBy: [{ tenantId: 'asc' }, { name: 'asc' }],
    });

    return policies.map((policy) => ({
      ...policy,
      scope: policy.tenantId ? 'tenant' : 'global',
    }));
  }

  async getPolicy(id: string, tenantId: string | null) {
    const where: Prisma.RetentionPolicyWhereInput = tenantId
      ? { id, OR: [{ tenantId }, { tenantId: null }] }
      : { id, tenantId: null };

    const policy = await prisma.retentionPolicy.findFirst({
      where,
      include: { rules: true, _count: { select: { boxes: true } } },
    });
    if (!policy) throw Object.assign(new Error('Polityka retencji nie znaleziona'), { statusCode: 404 });
    return {
      ...policy,
      scope: policy.tenantId ? 'tenant' : 'global',
    };
  }

  async createPolicy(tenantId: string | null, actor: IJwtPayload, data: any) {
    const scope = data.scope || 'tenant';
    if (scope === 'global') {
      this.assertCanManageGlobalPolicy(actor);
    } else if (!tenantId) {
      throw Object.assign(new Error('Wybierz tenanta, aby dodać politykę specyficzną dla tenanta'), { statusCode: 400 });
    }

    return prisma.retentionPolicy.create({
      data: {
        tenantId: scope === 'global' ? null : tenantId,
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

  async previewJrwa(buffer: Buffer, originalName: string, targetTenantId: string, actor: IJwtPayload) {
    this.assertCanManageGlobalPolicy(actor);
    const tenant = await prisma.tenant.findUnique({
      where: { id: targetTenantId },
      select: { id: true, name: true, shortCode: true },
    });
    if (!tenant) throw Object.assign(new Error('Wybrany tenant nie istnieje'), { statusCode: 404 });

    const parsed = await parseJrwaDocx(buffer);
    return {
      tenant,
      fileName: originalName,
      tableNumber: parsed.tableNumber,
      rows: parsed.rows,
      skipped: parsed.skipped,
      summary: {
        valid: parsed.rows.length,
        skipped: parsed.skipped.length,
        permanent: parsed.rows.filter((row) => row.isPermanent).length,
        review: parsed.rows.filter((row) => row.requiresReview).length,
      },
    };
  }

  async importJrwa(buffer: Buffer, originalName: string, targetTenantId: string, actor: IJwtPayload) {
    const preview = await this.previewJrwa(buffer, originalName, targetTenantId, actor);
    const existingPolicies = await prisma.retentionPolicy.findMany({
      where: {
        tenantId: targetTenantId,
        jrwaCode: { in: preview.rows.map((row) => row.jrwaCode) },
      },
      select: { id: true, jrwaCode: true },
    });
    const existingByCode = new Map(existingPolicies.map((policy) => [policy.jrwaCode, policy.id]));
    let created = 0;
    let updated = 0;
    const operations = preview.rows.map((row) => {
      const existingId = existingByCode.get(row.jrwaCode);
      const data = {
        name: row.name,
        docType: row.docType,
        retentionYears: row.retentionYears,
        retentionTrigger: 'end_date' as const,
        description: row.description,
        jrwaCode: row.jrwaCode,
        archivalCategory: row.archivalCategory,
        isPermanent: row.isPermanent,
        sourceFileName: originalName,
        isActive: true,
      };

      if (existingId) {
        updated++;
        return prisma.retentionPolicy.update({ where: { id: existingId }, data });
      }
      created++;
      return prisma.retentionPolicy.create({ data: { ...data, tenantId: targetTenantId } });
    });

    await prisma.$transaction(operations);

    return {
      created,
      updated,
      total: preview.rows.length,
      skipped: preview.skipped,
      tenant: preview.tenant,
      fileName: originalName,
    };
  }

  async updatePolicy(id: string, tenantId: string | null, actor: IJwtPayload, data: any) {
    const policy = await this.getPolicy(id, tenantId);
    if (!policy.tenantId) {
      this.assertCanManageGlobalPolicy(actor);
    }

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

  async deletePolicy(id: string, tenantId: string | null, actor: IJwtPayload) {
    const policy = await this.getPolicy(id, tenantId);
    if (!policy.tenantId) {
      this.assertCanManageGlobalPolicy(actor);
    }

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
  async recalculateForPolicy(policyId: string, tenantId: string | null, actor: IJwtPayload) {
    const policy = await this.getPolicy(policyId, tenantId);
    if (!policy.tenantId && !tenantId) {
      this.assertCanManageGlobalPolicy(actor);
    }

    const boxWhere: Prisma.BoxWhereInput = { retentionPolicyId: policyId };
    if (tenantId) boxWhere.tenantId = tenantId;

    const boxes = await prisma.box.findMany({
      where: boxWhere,
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

      if (baseDate && policy.retentionYears && !policy.isPermanent) {
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

    if (updated.count > 0) {
      await notificationService.notifyTenantUsers({
        tenantId,
        requiredPermissions: [Permissions.DISPOSAL_APPROVE],
        type: 'disposal_pending',
        title: 'Kartony oczekują na zatwierdzenie brakowania',
        message: `Do zatwierdzenia brakowania przekazano ${updated.count} kartonów.`,
        entityType: 'retention',
        actionUrl: '/admin/retention',
      });
    }

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

    if (updated.count > 0) {
      await notificationService.notifyTenantUsers({
        tenantId,
        requiredPermissions: [Permissions.DISPOSAL_INITIATE, Permissions.REPORT_VIEW],
        type: 'disposal_approved',
        title: 'Brakowanie zatwierdzone',
        message: `Zatwierdzono brakowanie ${updated.count} kartonów.`,
        entityType: 'retention',
        actionUrl: '/admin/retention',
      });
    }

    return { count: updated.count };
  }
}

export const retentionService = new RetentionService();
