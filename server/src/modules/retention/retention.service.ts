import { prisma } from '../../config/database';
import { BoxStatus, Prisma } from '@prisma/client';
import { IJwtPayload, Permissions, RoleCode } from '@archivecore/shared';
import { notificationService } from '../notifications/notification.service';
import { parseJrwaDocx } from './jrwa-import.parser';
import { randomUUID } from 'node:crypto';
import { parseJrwaValidFrom, previousJrwaDay } from './jrwa-version';

export class RetentionService {
  private async recordDisposalAudit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    boxIds: string[],
    actorId: string,
    action: string,
    oldStatus: BoxStatus,
    newStatus: BoxStatus,
    details: Record<string, string> = {},
  ) {
    await tx.auditLog.createMany({
      data: boxIds.map((boxId) => ({
        tenantId,
        userId: actorId,
        action,
        entityType: 'box',
        entityId: boxId,
        oldValues: { status: oldStatus },
        newValues: { status: newStatus, ...details },
      })),
    });
  }

  private assertClientDecision(tenantId: string, actor: IJwtPayload) {
    if (actor.tenantId !== tenantId || !actor.roles.some((role) =>
      role === RoleCode.TENANT_LEADERSHIP || role === RoleCode.ADMIN_TENANT
    )) {
      throw Object.assign(new Error('Decyzję o brakowaniu musi podjąć uprawniona osoba tego tenanta'), { statusCode: 403 });
    }
  }

  private disposalEligibility(tenantId: string): Prisma.BoxWhereInput {
    const restrictedCategory: Prisma.StringFilter = {
      startsWith: 'A',
      mode: 'insensitive',
    };
    return {
      tenantId,
      deletedAt: null,
      legalHold: false,
      hrFolders: { none: {} },
      retentionPolicy: {
        is: {
          isActive: true,
          isPermanent: false,
          AND: [
            { OR: [{ tenantId: null }, { tenantId }] },
            { OR: [
              { archivalCategory: null },
              { NOT: { OR: [
                { archivalCategory: restrictedCategory },
                { archivalCategory: { startsWith: 'BE', mode: 'insensitive' } },
              ] } },
            ] },
          ],
        },
      },
      transferListItems: {
        none: { OR: [
          { categoryCode: restrictedCategory },
          { categoryCode: { startsWith: 'BE', mode: 'insensitive' } },
          { disposalOrTransferDate: { gt: new Date() } },
        ] },
      },
    };
  }

  private isSuperAdmin(actor?: IJwtPayload) {
    return Boolean(
      actor?.roles.includes(RoleCode.SUPER_ADMIN)
      || actor?.permissions.includes(Permissions.SYSTEM_CONFIG)
    );
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
        jrwaVersion: { select: { id: true, label: true, validFrom: true, validTo: true } },
        tenant: { select: { id: true, name: true, shortCode: true } },
        _count: { select: { boxes: true, folders: true } },
      },
      orderBy: [{ tenantId: 'asc' }, { name: 'asc' }],
    });

    return policies.map((policy) => ({
      ...policy,
      scope: policy.tenantId ? 'tenant' : 'global',
    }));
  }

  async listJrwaVersions(tenantId: string | null, actor?: IJwtPayload, requestedTenantId?: string) {
    if (requestedTenantId && !this.isSuperAdmin(actor) && requestedTenantId !== tenantId) {
      throw Object.assign(new Error('Nie masz dostępu do JRWA tego tenanta'), { statusCode: 403 });
    }
    const effectiveTenantId = requestedTenantId || tenantId;
    if (!effectiveTenantId) return [];
    return prisma.jrwaVersion.findMany({
      where: { tenantId: effectiveTenantId },
      orderBy: { validFrom: 'desc' },
      include: { _count: { select: { policies: true } } },
    });
  }

  async getPolicy(id: string, tenantId: string | null) {
    const where: Prisma.RetentionPolicyWhereInput = tenantId
      ? { id, OR: [{ tenantId }, { tenantId: null }] }
      : { id, tenantId: null };

    const policy = await prisma.retentionPolicy.findFirst({
      where,
      include: { rules: true, jrwaVersion: true, _count: { select: { boxes: true, folders: true } } },
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

  async importJrwa(buffer: Buffer, originalName: string, targetTenantId: string, actor: IJwtPayload, labelInput: unknown, validFromInput: unknown) {
    const label = typeof labelInput === 'string' ? labelInput.trim() : '';
    if (!label || label.length > 120) {
      throw Object.assign(new Error('Podaj nazwę wersji JRWA (maksymalnie 120 znaków)'), { statusCode: 400 });
    }
    const validFrom = parseJrwaValidFrom(validFromInput);
    const preview = await this.previewJrwa(buffer, originalName, targetTenantId, actor);
    const codes = new Set<string>();
    for (const row of preview.rows) {
      if (codes.has(row.jrwaCode)) {
        throw Object.assign(new Error(`Powtórzony symbol JRWA w pliku: ${row.jrwaCode}`), { statusCode: 400 });
      }
      codes.add(row.jrwaCode);
    }

    let version;
    try {
      version = await prisma.$transaction(async (tx) => {
        const latest = await tx.jrwaVersion.findFirst({
          where: { tenantId: targetTenantId },
          orderBy: { validFrom: 'desc' },
        });
        if (latest && validFrom <= latest.validFrom) {
          throw Object.assign(new Error('Nowa wersja JRWA musi obowiązywać później niż ostatnia zapisana wersja'), { statusCode: 409 });
        }
        const createdVersion = await tx.jrwaVersion.create({
          data: { tenantId: targetTenantId, label, validFrom, sourceFileName: originalName },
        });
        if (latest) {
          await tx.jrwaVersion.update({ where: { id: latest.id }, data: { validTo: previousJrwaDay(validFrom) } });
        }
        await tx.retentionPolicy.createMany({
          data: preview.rows.map((row) => ({
            tenantId: targetTenantId,
            jrwaVersionId: createdVersion.id,
            name: row.name,
            docType: row.docType,
            retentionYears: row.retentionYears,
            retentionTrigger: 'end_date',
            description: row.description,
            jrwaCode: row.jrwaCode,
            archivalCategory: row.archivalCategory,
            isPermanent: row.isPermanent,
            sourceFileName: originalName,
            isActive: true,
          })),
        });
        return createdVersion;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) {
        throw Object.assign(new Error('Wersja lub data JRWA już istnieje. Odśwież listę i wybierz inną.'), { statusCode: 409 });
      }
      throw error;
    }

    return {
      version,
      created: preview.rows.length,
      updated: 0,
      total: preview.rows.length,
      skipped: preview.skipped,
      tenant: preview.tenant,
      fileName: originalName,
    };
  }

  async updatePolicy(id: string, tenantId: string | null, actor: IJwtPayload, data: any) {
    const policy = await this.getPolicy(id, tenantId);
    if (policy.jrwaCode) {
      throw Object.assign(new Error('Pozycji JRWA nie można edytować. Zaimportuj nową wersję wykazu.'), { statusCode: 409 });
    }
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
    if (policy.jrwaCode) {
      throw Object.assign(new Error('Pozycji JRWA nie można usunąć. Zachowaj historię wersji.'), { statusCode: 409 });
    }
    if (!policy.tenantId) {
      this.assertCanManageGlobalPolicy(actor);
    }

    if (policy._count.boxes > 0 || policy._count.folders > 0) {
      throw Object.assign(
        new Error('Nie można usunąć polityki — przypisane kartony lub teczki'),
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

    const boxWhere: Prisma.BoxWhereInput = { retentionPolicyId: policyId, deletedAt: null };
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

  // Candidates are suggestions for human review, never automatic disposal.
  async getBoxesForReview(tenantId: string, daysAhead: number = 90, scope: 'due' | 'upcoming' = 'upcoming', page = 1, limit = 25) {
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);
    const where: Prisma.BoxWhereInput = {
      ...this.disposalEligibility(tenantId),
      status: 'active',
      retentionDate: scope === 'due' ? { lte: now } : { gt: now, lte: futureDate },
    };
    const [data, total] = await Promise.all([
      prisma.box.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ retentionDate: 'asc' }, { id: 'asc' }],
        include: {
          location: { select: { fullPath: true } },
          retentionPolicy: { select: { name: true, retentionYears: true, archivalCategory: true } },
        },
      }),
      prisma.box.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async getPendingDisposal(tenantId: string, page = 1, limit = 25) {
    const where: Prisma.BoxWhereInput = { tenantId, deletedAt: null, status: 'pending_disposal' };
    const [data, total] = await Promise.all([
      prisma.box.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        include: {
          location: { select: { fullPath: true } },
          retentionPolicy: { select: { name: true, archivalCategory: true } },
        },
      }),
      prisma.box.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async getApprovedDisposal(tenantId: string, page = 1, limit = 25) {
    const where: Prisma.BoxWhereInput = { tenantId, deletedAt: null, status: 'approved_disposal' };
    const [data, total] = await Promise.all([
      prisma.box.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        include: {
          location: { select: { fullPath: true } },
          retentionPolicy: { select: { name: true, archivalCategory: true } },
        },
      }),
      prisma.box.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async getCompletedDisposal(tenantId: string, page = 1, limit = 25) {
    const where: Prisma.AuditLogWhereInput = { tenantId, entityType: 'disposal_batch', action: 'disposal.batch_completed' };
    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { entityId: true, createdAt: true, newValues: true, user: { select: { firstName: true, lastName: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return { data: data.map((entry) => ({
      id: entry.entityId,
      completedAt: entry.createdAt,
      completedBy: entry.newValues && typeof entry.newValues === 'object' && !Array.isArray(entry.newValues) && typeof entry.newValues.completedByName === 'string'
        ? entry.newValues.completedByName
        : `${entry.user.firstName} ${entry.user.lastName}`,
      ...(entry.newValues && typeof entry.newValues === 'object' && !Array.isArray(entry.newValues) ? {
        protocolReference: entry.newValues.protocolReference,
        boxCount: Array.isArray(entry.newValues.boxes) ? entry.newValues.boxes.length : 0,
      } : { protocolReference: '', boxCount: 0 }),
    })), total, page, limit };
  }

  async getCompletedDisposalRecord(tenantId: string, id: string) {
    const record = await prisma.auditLog.findFirst({
      where: { tenantId, entityId: id, entityType: 'disposal_batch', action: 'disposal.batch_completed' },
      include: {
        tenant: { select: { name: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    });
    if (!record) throw Object.assign(new Error('Potwierdzenie brakowania nie zostało znalezione'), { statusCode: 404 });
    return record;
  }

  // Initiate disposal process
  async initiateDisposal(tenantId: string, boxIds: string[], actorId: string, notes?: string) {
    const uniqueIds = [...new Set(boxIds)];
    const updated = await prisma.$transaction(async (tx) => {
      const where: Prisma.BoxWhereInput = {
        ...this.disposalEligibility(tenantId),
        id: { in: uniqueIds }, status: 'active', retentionDate: { lte: new Date() },
      };
      const result = await tx.box.updateMany({ where, data: { status: 'pending_disposal' } });
      if (result.count !== uniqueIds.length) {
        throw Object.assign(new Error('Co najmniej jeden karton nie spełnia warunków brakowania: termin, polityka, kategoria lub blokada'), { statusCode: 409 });
      }
      await this.recordDisposalAudit(tx, tenantId, uniqueIds, actorId, 'disposal.proposed', 'active', 'pending_disposal', notes ? { notes } : {});
      return result;
    });

    if (updated.count > 0) {
      await notificationService.notifyTenantUsers({
        tenantId,
        requiredPermissions: [Permissions.DISPOSAL_APPROVE],
        includeGlobalUsers: false,
        type: 'disposal_pending',
        title: 'Kartony oczekują na zatwierdzenie brakowania',
        message: `Do zatwierdzenia brakowania przekazano ${updated.count} kartonów.`,
        entityType: 'retention',
        actionUrl: '/admin/retention',
      });
    }

    return { count: updated.count, boxIds: uniqueIds };
  }

  // Client approval does not change warehouse occupancy.
  async approveDisposal(tenantId: string, boxIds: string[], actor: IJwtPayload, notes?: string) {
    this.assertClientDecision(tenantId, actor);
    const uniqueIds = [...new Set(boxIds)];
    const updated = await prisma.$transaction(async (tx) => {
      const where: Prisma.BoxWhereInput = {
        ...this.disposalEligibility(tenantId),
        id: { in: uniqueIds }, status: 'pending_disposal', retentionDate: { lte: new Date() },
      };
      const proposals = await tx.auditLog.findMany({
        where: { tenantId, entityType: 'box', entityId: { in: uniqueIds }, action: 'disposal.proposed' },
        orderBy: { createdAt: 'desc' },
        select: { entityId: true, userId: true },
      });
      const latestProposer = new Map<string, string>();
      for (const proposal of proposals) {
        if (proposal.entityId && !latestProposer.has(proposal.entityId)) latestProposer.set(proposal.entityId, proposal.userId);
      }
      if (uniqueIds.some((id) => latestProposer.get(id) === actor.userId)) {
        throw Object.assign(new Error('Nie można zatwierdzić własnej propozycji brakowania'), { statusCode: 409 });
      }
      const result = await tx.box.updateMany({ where, data: { status: 'approved_disposal' } });
      if (result.count !== uniqueIds.length) {
        throw Object.assign(new Error('Co najmniej jeden karton nie spełnia warunków zatwierdzenia brakowania'), { statusCode: 409 });
      }
      await this.recordDisposalAudit(tx, tenantId, uniqueIds, actor.userId, 'disposal.client_approved', 'pending_disposal', 'approved_disposal', notes ? { notes } : {});
      return result;
    });

    if (updated.count > 0) {
      await notificationService.notifyTenantUsers({
        tenantId,
        requiredPermissions: [Permissions.DISPOSAL_COMPLETE],
        type: 'disposal_approved',
        title: 'Klient zaakceptował propozycję brakowania',
        message: `Klient zaakceptował propozycję brakowania ${updated.count} kartonów. Zajętość magazynu nie została zmieniona.`,
        entityType: 'retention',
        actionUrl: '/admin/retention',
      });
    }

    return { count: updated.count };
  }

  async rejectDisposal(tenantId: string, boxIds: string[], actor: IJwtPayload, reason: string) {
    this.assertClientDecision(tenantId, actor);
    const uniqueIds = [...new Set(boxIds)];
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.box.updateMany({
        where: { id: { in: uniqueIds }, tenantId, deletedAt: null, status: 'pending_disposal' },
        data: { status: 'active' },
      });
      if (result.count !== uniqueIds.length) {
        throw Object.assign(new Error('Stan kartonów zmienił się. Odśwież listę i spróbuj ponownie.'), { statusCode: 409 });
      }
      await this.recordDisposalAudit(tx, tenantId, uniqueIds, actor.userId, 'disposal.client_rejected', 'pending_disposal', 'active', { reason });
      return result;
    });

    if (updated.count > 0) {
      await notificationService.notifyTenantUsers({
        tenantId,
        requiredPermissions: [Permissions.DISPOSAL_INITIATE],
        type: 'disposal_rejected',
        title: 'Klient odrzucił propozycję brakowania',
        message: `Klient odrzucił propozycję brakowania ${updated.count} kartonów.`,
        entityType: 'retention',
        actionUrl: '/admin/retention',
      });
    }
    return { count: updated.count };
  }

  async completeDisposal(
    tenantId: string,
    boxIds: string[],
    actorId: string,
    protocolReference: string,
    details: { methodDescription?: string; weightKg?: number; executionNote?: string } = {},
  ) {
    const uniqueIds = [...new Set(boxIds)];
    const batchId = randomUUID();
    const completedAt = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const where: Prisma.BoxWhereInput = {
        ...this.disposalEligibility(tenantId),
        id: { in: uniqueIds }, status: 'approved_disposal', retentionDate: { lte: new Date() },
      };
      const boxes = await tx.box.findMany({ where, select: {
        id: true, locationId: true, boxNumber: true, title: true,
        location: { select: { fullPath: true } },
      } });
      if (boxes.length !== uniqueIds.length) {
        throw Object.assign(new Error('Co najmniej jeden karton nie ma ważnej zgody lub jest objęty blokadą'), { statusCode: 409 });
      }
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      const operator = await tx.user.findUnique({ where: { id: actorId }, select: { firstName: true, lastName: true } });
      if (!tenant || !operator) throw Object.assign(new Error('Nie znaleziono klienta lub operatora brakowania'), { statusCode: 409 });
      const result = await tx.box.updateMany({ where, data: { status: 'disposed', disposalDate: completedAt, locationId: null } });
      if (result.count !== boxes.length) {
        throw Object.assign(new Error('Stan kartonów zmienił się. Spróbuj ponownie.'), { statusCode: 409 });
      }
      await tx.folder.updateMany({
        where: { tenantId, boxId: { in: uniqueIds } },
        data: { status: 'disposed' },
      });
      const locationIds = new Set(boxes.map((box) => box.locationId).filter((id): id is string => Boolean(id)));
      for (const locationId of locationIds) {
        const currentCount = await tx.box.count({ where: { locationId, deletedAt: null, status: { not: 'disposed' } } });
        await tx.location.update({ where: { id: locationId }, data: { currentCount } });
      }
      await tx.auditLog.createMany({
        data: [...boxes.map((box) => ({
          tenantId,
          userId: actorId,
          action: 'disposal.completed',
          entityType: 'box',
          entityId: box.id,
          oldValues: { status: 'approved_disposal', locationId: box.locationId },
          newValues: { status: 'disposed', locationId: null, protocolReference, batchId },
        })), {
          tenantId,
          userId: actorId,
          action: 'disposal.batch_completed',
          entityType: 'disposal_batch',
          entityId: batchId,
          oldValues: Prisma.JsonNull,
          newValues: {
            protocolReference,
            completedAt: completedAt.toISOString(),
            tenantName: tenant.name,
            completedByName: `${operator.firstName} ${operator.lastName}`,
            ...(details.methodDescription ? { methodDescription: details.methodDescription } : {}),
            ...(details.weightKg !== undefined ? { weightKg: details.weightKg } : {}),
            ...(details.executionNote ? { executionNote: details.executionNote } : {}),
            boxes: boxes.map((box) => ({
              id: box.id,
              boxNumber: box.boxNumber,
              title: box.title,
              location: box.location?.fullPath || null,
            })),
          },
        }],
      });
      return result;
    });

    if (updated.count > 0) {
      await notificationService.notifyTenantUsers({
        tenantId,
        requiredPermissions: [Permissions.DISPOSAL_APPROVE],
        includeGlobalUsers: false,
        type: 'disposal_completed',
        title: 'Brakowanie wykonane',
        message: `Potwierdzono wykonanie brakowania ${updated.count} kartonów. Protokół: ${protocolReference}.`,
        entityType: 'retention',
        actionUrl: '/admin/retention',
      });
    }
    return { count: updated.count, batchId };
  }
}

export const retentionService = new RetentionService();
