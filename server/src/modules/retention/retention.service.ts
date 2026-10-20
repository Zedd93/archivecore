import { prisma } from '../../config/database';
import { ApDisposalDecision, BoxStatus, Prisma } from '@prisma/client';
import { DISPOSAL_COOLING_OFF_DAYS, DISPOSAL_FOUR_EYES_THRESHOLD, IJwtPayload, Permissions, RoleCode } from '@archivecore/shared';
import { notificationService } from '../notifications/notification.service';
import { parseJrwaDocx } from './jrwa-import.parser';
import { randomUUID } from 'node:crypto';
import { parseJrwaValidFrom, previousJrwaDay } from './jrwa-version';
import { clearedDisposalDecisions } from './disposal-state';
import { validateDisposalSignature } from './disposal-signature';

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
      folders: { none: { OR: [
        { legalHold: true },
        { retentionPolicy: { is: { seriesLegalHold: true } } },
        { retentionPolicy: { is: { isPermanent: true } } },
        { retentionPolicy: { is: { archivalCategory: restrictedCategory } } },
        { retentionPolicy: { is: { archivalCategory: { startsWith: 'BE', mode: 'insensitive' } } } },
        { transferListItem: null },
        { documents: { some: { legalHold: true } } },
        { transferListItem: { is: { transferList: { legalHold: true } } } },
      ] } },
      documents: { none: { legalHold: true } },
      retentionPolicy: {
        is: {
          isActive: true,
          isPermanent: false,
          seriesLegalHold: false,
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
          { transferList: { legalHold: true } },
          { folder: { legalHold: true } },
          { folder: { retentionPolicy: { is: { seriesLegalHold: true } } } },
          { folder: { documents: { some: { legalHold: true } } } },
          { categoryCode: restrictedCategory },
          { categoryCode: { startsWith: 'BE', mode: 'insensitive' } },
          { disposalOrTransferDate: { gt: new Date() } },
        ] },
      },
    };
  }

  private async assertFolderRetentionElapsed(
    tx: Prisma.TransactionClient,
    tenantId: string,
    boxIds: string[],
    now: Date,
  ) {
    const folders = await tx.folder.findMany({
      where: { tenantId, boxId: { in: boxIds } },
      select: {
        id: true, createdAt: true, dateTo: true,
        retentionPolicy: { select: { retentionTrigger: true, retentionYears: true } },
        transferListItem: { select: { categoryCode: true, dateTo: true } },
      },
    });
    for (const folder of folders) {
      const policy = folder.retentionPolicy;
      const item = folder.transferListItem;
      const categoryYears = item?.categoryCode.match(/^B(\d+)$/i);
      if ((!policy && !item) || (item && !categoryYears)) {
        throw Object.assign(new Error('Nie można ustalić terminu retencji jednej z teczek. Brakowanie zostało wstrzymane.'), { statusCode: 409 });
      }
      const terms: { years: number | null; baseDate: Date | null | undefined }[] = [];
      if (policy) terms.push({
        years: policy.retentionYears,
        baseDate: policy.retentionTrigger === 'creation_date' ? folder.createdAt
          : policy.retentionTrigger === 'end_date' ? folder.dateTo : null,
      });
      if (item && categoryYears) terms.push({ years: Number(categoryYears[1]), baseDate: item.dateTo ?? folder.dateTo });
      for (const { years, baseDate } of terms) {
        if (years === null || years < 0 || !Number.isSafeInteger(years) || !baseDate) {
          throw Object.assign(new Error('Nie można ustalić terminu retencji jednej z teczek. Brakowanie zostało wstrzymane.'), { statusCode: 409 });
        }
        const dueAt = new Date(baseDate);
        dueAt.setFullYear(dueAt.getFullYear() + years);
        if (dueAt > now) {
          throw Object.assign(new Error('Okres retencji jednej z teczek jeszcze nie upłynął. Brakowanie zostało wstrzymane.'), { statusCode: 409 });
        }
      }
    }
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
        const heldPolicies = await tx.retentionPolicy.findMany({
          where: { tenantId: targetTenantId, jrwaCode: { in: [...codes] }, seriesLegalHold: true },
          select: { jrwaCode: true, seriesLegalHoldReason: true, seriesLegalHoldAt: true },
        });
        const holds = new Map(heldPolicies.map((policy) => [policy.jrwaCode, policy]));
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
            seriesLegalHold: holds.has(row.jrwaCode),
            seriesLegalHoldReason: holds.get(row.jrwaCode)?.seriesLegalHoldReason ?? null,
            seriesLegalHoldAt: holds.get(row.jrwaCode)?.seriesLegalHoldAt ?? null,
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

  async setJrwaSeriesLegalHold(policyId: string, tenantId: string | null, actor: IJwtPayload, hold: boolean, reason: string) {
    return prisma.$transaction(async (tx) => {
      const policy = await tx.retentionPolicy.findUnique({
        where: { id: policyId },
        select: { tenantId: true, jrwaCode: true },
      });
      if (!policy?.tenantId || !policy.jrwaCode) {
        throw Object.assign(new Error('Nie znaleziono serii JRWA'), { statusCode: 404 });
      }
      if (!this.isSuperAdmin(actor) && policy.tenantId !== tenantId) {
        throw Object.assign(new Error('Nie masz dostępu do serii JRWA tego tenanta'), { statusCode: 403 });
      }
      const series = { tenantId: policy.tenantId, jrwaCode: policy.jrwaCode };
      const previous = await tx.retentionPolicy.findFirst({
        where: { ...series, seriesLegalHold: true },
        select: { seriesLegalHoldReason: true },
      });
      if (Boolean(previous) === hold) {
        throw Object.assign(new Error('Stan blokady zmienił się. Odśwież stronę i spróbuj ponownie.'), { statusCode: 409 });
      }
      const data = {
        seriesLegalHold: hold,
        seriesLegalHoldReason: hold ? reason : null,
        seriesLegalHoldAt: hold ? new Date() : null,
      };
      await tx.retentionPolicy.updateMany({ where: series, data });
      const affected = hold ? await tx.box.updateMany({
        where: {
          tenantId: policy.tenantId, deletedAt: null,
          status: { in: ['pending_disposal', 'approved_disposal'] },
          OR: [
            { retentionPolicy: { is: series } },
            { folders: { some: { retentionPolicy: { is: series } } } },
            { transferListItems: { some: { folder: { retentionPolicy: { is: series } } } } },
          ],
        },
        data: { status: 'active', ...clearedDisposalDecisions },
      }) : { count: 0 };
      await tx.auditLog.create({ data: {
        tenantId: policy.tenantId, userId: actor.userId, entityType: 'jrwa_series', entityId: policyId,
        action: hold ? 'legal_hold.placed' : 'legal_hold.released',
        oldValues: { seriesLegalHold: Boolean(previous), seriesLegalHoldReason: previous?.seriesLegalHoldReason ?? null },
        newValues: { ...data, jrwaCode: policy.jrwaCode, reason, withdrawnBoxes: affected.count },
      } });
      return { ...data, jrwaCode: policy.jrwaCode, withdrawnBoxes: affected.count };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
    const proposalBatchId = randomUUID();
    const fourEyesRequired = uniqueIds.length >= DISPOSAL_FOUR_EYES_THRESHOLD;
    const updated = await prisma.$transaction(async (tx) => {
      const where: Prisma.BoxWhereInput = {
        ...this.disposalEligibility(tenantId),
        id: { in: uniqueIds }, status: 'active', retentionDate: { lte: new Date() },
      };
      const result = await tx.box.updateMany({ where, data: {
        status: 'pending_disposal', ...clearedDisposalDecisions,
        disposalProposalBatchId: proposalBatchId,
        disposalFourEyesRequired: fourEyesRequired,
      } });
      if (result.count !== uniqueIds.length) {
        throw Object.assign(new Error('Co najmniej jeden karton nie spełnia warunków brakowania: termin, polityka, kategoria lub blokada'), { statusCode: 409 });
      }
      await this.recordDisposalAudit(tx, tenantId, uniqueIds, actorId, 'disposal.proposed', 'active', 'pending_disposal', {
        proposalBatchId, fourEyesRequired: String(fourEyesRequired), ...(notes ? { notes } : {}),
      });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (updated.count > 0) {
      await notificationService.notifyTenantUsers({
        tenantId,
        requiredPermissions: [Permissions.DISPOSAL_INITIATE],
        type: 'disposal_pending',
        title: 'Kartony oczekują na wewnętrzną weryfikację',
        message: `Do weryfikacji brakowania przekazano ${updated.count} kartonów.`,
        entityType: 'retention',
        actionUrl: '/admin/retention',
      });
    }

    return { count: updated.count, boxIds: uniqueIds, proposalBatchId, fourEyesRequired };
  }

  async reviewDisposal(tenantId: string, boxIds: string[], actorId: string, notes: string) {
    const uniqueIds = [...new Set(boxIds)];
    const reviewedAt = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const where: Prisma.BoxWhereInput = {
        ...this.disposalEligibility(tenantId),
        id: { in: uniqueIds }, status: 'pending_disposal', disposalReviewedAt: null,
        retentionDate: { lte: reviewedAt },
      };
      const result = await tx.box.updateMany({ where, data: {
        disposalReviewedAt: reviewedAt, disposalReviewedById: actorId, disposalReviewNotes: notes,
      } });
      if (result.count !== uniqueIds.length) {
        throw Object.assign(new Error('Nie można zweryfikować wszystkich kartonów. Sprawdź ich stan i blokady.'), { statusCode: 409 });
      }
      await this.recordDisposalAudit(tx, tenantId, uniqueIds, actorId, 'disposal.reviewed', 'pending_disposal', 'pending_disposal', { notes });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (updated.count) await notificationService.notifyTenantUsers({
      tenantId, requiredPermissions: [Permissions.DISPOSAL_APPROVE], includeGlobalUsers: false,
      type: 'disposal_pending', title: 'Propozycja brakowania po weryfikacji',
      message: `Do zatwierdzenia przekazano ${updated.count} kartonów.`,
      entityType: 'retention', actionUrl: '/admin/retention',
    });
    return { count: updated.count };
  }

  // Client approval does not change warehouse occupancy.
  async approveDisposal(tenantId: string, boxIds: string[], actor: IJwtPayload, notes?: string) {
    this.assertClientDecision(tenantId, actor);
    const uniqueIds = [...new Set(boxIds)];
    const approvedAt = new Date();
    const disposalCoolingOffUntil = new Date(approvedAt.getTime() + DISPOSAL_COOLING_OFF_DAYS * 24 * 60 * 60 * 1000);
    const updated = await prisma.$transaction(async (tx) => {
      const where: Prisma.BoxWhereInput = {
        ...this.disposalEligibility(tenantId),
        id: { in: uniqueIds }, status: 'pending_disposal', disposalReviewedAt: { not: null }, retentionDate: { lte: new Date() },
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
      const result = await tx.box.updateMany({ where, data: {
        status: 'approved_disposal', disposalFirstApprovedById: actor.userId, disposalCoolingOffUntil,
      } });
      if (result.count !== uniqueIds.length) {
        throw Object.assign(new Error('Co najmniej jeden karton nie spełnia warunków zatwierdzenia brakowania'), { statusCode: 409 });
      }
      await this.recordDisposalAudit(tx, tenantId, uniqueIds, actor.userId, 'disposal.client_approved', 'pending_disposal', 'approved_disposal', {
        disposalCoolingOffUntil: disposalCoolingOffUntil.toISOString(), ...(notes ? { notes } : {}),
      });
      const secondApprovalRequiredCount = await tx.box.count({ where: {
        id: { in: uniqueIds }, tenantId, status: 'approved_disposal', disposalFourEyesRequired: true,
      } });
      return { count: result.count, secondApprovalRequiredCount };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (updated.count > 0) {
      if (updated.secondApprovalRequiredCount > 0) await notificationService.notifyTenantUsers({
        tenantId,
        requiredPermissions: [Permissions.DISPOSAL_APPROVE],
        includeGlobalUsers: false,
        excludeUserIds: [actor.userId],
        type: 'disposal_approved',
        title: 'Duża partia czeka na drugą akceptację',
        message: `${updated.secondApprovalRequiredCount} kartonów wymaga decyzji drugiej osoby uprawnionej u klienta.`,
        entityType: 'retention', actionUrl: '/admin/retention',
      });
      if (updated.secondApprovalRequiredCount < updated.count) await notificationService.notifyTenantUsers({
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

  async secondApproveDisposal(tenantId: string, boxIds: string[], actor: IJwtPayload, notes?: string) {
    this.assertClientDecision(tenantId, actor);
    const uniqueIds = [...new Set(boxIds)];
    const secondApprovedAt = new Date();
    const disposalCoolingOffUntil = new Date(secondApprovedAt.getTime() + DISPOSAL_COOLING_OFF_DAYS * 24 * 60 * 60 * 1000);
    const result = await prisma.$transaction(async (tx) => {
      const where: Prisma.BoxWhereInput = {
        ...this.disposalEligibility(tenantId),
        id: { in: uniqueIds }, status: 'approved_disposal',
        disposalFourEyesRequired: true,
        disposalFirstApprovedById: { not: null },
        disposalSecondApprovedAt: null,
        retentionDate: { lte: secondApprovedAt },
      };
      const boxes = await tx.box.findMany({ where, select: { id: true, disposalFirstApprovedById: true } });
      if (boxes.length !== uniqueIds.length || boxes.some((box) => box.disposalFirstApprovedById === actor.userId)) {
        throw Object.assign(new Error('Druga akceptacja wymaga innej uprawnionej osoby i aktualnej partii'), { statusCode: 409 });
      }
      const proposals = await tx.auditLog.findMany({
        where: { tenantId, entityType: 'box', entityId: { in: uniqueIds }, action: 'disposal.proposed' },
        orderBy: { createdAt: 'desc' }, select: { entityId: true, userId: true },
      });
      const latestProposer = new Map<string, string>();
      for (const proposal of proposals) {
        if (proposal.entityId && !latestProposer.has(proposal.entityId)) latestProposer.set(proposal.entityId, proposal.userId);
      }
      if (uniqueIds.some((id) => !latestProposer.has(id) || latestProposer.get(id) === actor.userId)) {
        throw Object.assign(new Error('Brak śladu propozycji lub próba drugiej akceptacji własnej propozycji'), { statusCode: 409 });
      }
      const updated = await tx.box.updateMany({
        where: { ...where, disposalFirstApprovedById: { not: actor.userId } },
        data: { disposalSecondApprovedById: actor.userId, disposalSecondApprovedAt: secondApprovedAt, disposalCoolingOffUntil },
      });
      if (updated.count !== uniqueIds.length) {
        throw Object.assign(new Error('Stan partii zmienił się. Odśwież listę i spróbuj ponownie.'), { statusCode: 409 });
      }
      await this.recordDisposalAudit(tx, tenantId, uniqueIds, actor.userId,
        'disposal.client_second_approved', 'approved_disposal', 'approved_disposal', {
          disposalCoolingOffUntil: disposalCoolingOffUntil.toISOString(), ...(notes ? { notes } : {}),
        });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (result.count) await notificationService.notifyTenantUsers({
      tenantId, requiredPermissions: [Permissions.DISPOSAL_COMPLETE],
      type: 'disposal_approved', title: 'Duża partia zatwierdzona przez drugą osobę',
      message: `Druga osoba zaakceptowała brakowanie ${result.count} kartonów.`,
      entityType: 'retention', actionUrl: '/admin/retention',
    });
    return { count: result.count };
  }

  async rejectDisposal(tenantId: string, boxIds: string[], actor: IJwtPayload, reason: string) {
    this.assertClientDecision(tenantId, actor);
    const uniqueIds = [...new Set(boxIds)];
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.box.updateMany({
        where: { id: { in: uniqueIds }, tenantId, deletedAt: null, status: 'pending_disposal' },
        data: { status: 'active', ...clearedDisposalDecisions },
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

  async withdrawDisposal(tenantId: string, boxIds: string[], actor: IJwtPayload, reason: string) {
    this.assertClientDecision(tenantId, actor);
    const uniqueIds = [...new Set(boxIds)];
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.box.updateMany({
        where: { id: { in: uniqueIds }, tenantId, deletedAt: null, status: 'approved_disposal' },
        data: { status: 'active', ...clearedDisposalDecisions },
      });
      if (result.count !== uniqueIds.length) {
        throw Object.assign(new Error('Nie można wycofać zgody: co najmniej jeden karton został już wybrakowany lub zmienił stan.'), { statusCode: 409 });
      }
      await this.recordDisposalAudit(tx, tenantId, uniqueIds, actor.userId,
        'disposal.client_withdrawn', 'approved_disposal', 'active', { reason });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (updated.count) await notificationService.notifyTenantUsers({
      tenantId, requiredPermissions: [Permissions.DISPOSAL_INITIATE, Permissions.DISPOSAL_COMPLETE],
      type: 'disposal_rejected', title: 'Klient wycofał zgodę na brakowanie',
      message: `Klient wycofał zgodę na brakowanie ${updated.count} kartonów.`,
      entityType: 'retention', actionUrl: '/admin/retention',
    });
    return { count: updated.count };
  }

  async recordApDecision(
    tenantId: string,
    boxIds: string[],
    actor: IJwtPayload,
    decision: ApDisposalDecision,
    reference?: string,
    decisionDate?: string,
    reason?: string,
  ) {
    if (decision === 'not_required' && !actor.roles.includes(RoleCode.SUPER_ADMIN)) {
      throw Object.assign(new Error('Tylko Super Admin może stwierdzić brak obowiązku zgody AP'), { statusCode: 403 });
    }
    let date: Date | null = null;
    if (decision === 'consent_received') {
      date = new Date(`${decisionDate}T00:00:00.000Z`);
      if (!decisionDate || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== decisionDate || date > new Date()) {
        throw Object.assign(new Error('Podaj poprawną datę otrzymanej zgody AP'), { statusCode: 400 });
      }
    }
    const uniqueIds = [...new Set(boxIds)];
    const recordedAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const where: Prisma.BoxWhereInput = {
        ...this.disposalEligibility(tenantId),
        id: { in: uniqueIds }, status: 'approved_disposal', apDecision: null,
        OR: [{ disposalFourEyesRequired: false }, { disposalSecondApprovedAt: { not: null } }],
        retentionDate: { lte: recordedAt },
      };
      const updated = await tx.box.updateMany({ where, data: {
        apDecision: decision, apDecisionReference: reference || null,
        apDecisionDate: date, apDecisionReason: reason || null,
        apDecisionById: actor.userId, apDecisionAt: recordedAt,
      } });
      if (updated.count !== uniqueIds.length) {
        throw Object.assign(new Error('Nie można zapisać decyzji AP dla wszystkich kartonów. Sprawdź ich stan i blokady.'), { statusCode: 409 });
      }
      await this.recordDisposalAudit(tx, tenantId, uniqueIds, actor.userId, 'disposal.ap_recorded', 'approved_disposal', 'approved_disposal', {
        decision, ...(reference ? { reference } : {}), ...(decisionDate ? { decisionDate } : {}), ...(reason ? { reason } : {}),
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { count: result.count };
  }

  async completeDisposal(
    tenantId: string,
    boxIds: string[],
    actorId: string,
    protocolReference: string,
    details: { methodDescription: string; weightKg: number; standardReference: string; signatureData: string; executionNote?: string },
  ) {
    validateDisposalSignature(details.signatureData);
    const uniqueIds = [...new Set(boxIds)];
    const batchId = randomUUID();
    const completedAt = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const where: Prisma.BoxWhereInput = {
        ...this.disposalEligibility(tenantId),
        id: { in: uniqueIds }, status: 'approved_disposal', apDecision: { not: null },
        AND: [
          { OR: [{ disposalFourEyesRequired: false }, { disposalSecondApprovedAt: { not: null } }] },
          { disposalCoolingOffUntil: { lte: completedAt } },
        ],
        retentionDate: { lte: completedAt },
      };
      const boxes = await tx.box.findMany({ where, select: {
        id: true, locationId: true, boxNumber: true, title: true,
        apDecision: true, apDecisionReference: true, apDecisionDate: true, apDecisionReason: true,
        disposalFirstApprovedById: true, disposalSecondApprovedById: true,
        disposalCoolingOffUntil: true,
        location: { select: { fullPath: true } },
      } });
      if (boxes.length !== uniqueIds.length) {
        throw Object.assign(new Error('Brakowanie zablokowane: sprawdź decyzję AP, blokady i 7-dniowy okres na wycofanie zgody.'), { statusCode: 409 });
      }
      await this.assertFolderRetentionElapsed(tx, tenantId, uniqueIds, completedAt);
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, nip: true, address: true } });
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
            tenantNip: tenant.nip,
            tenantAddress: tenant.address,
            completedByName: `${operator.firstName} ${operator.lastName}`,
            methodDescription: details.methodDescription,
            weightKg: details.weightKg,
            standardReference: details.standardReference,
            signatureData: details.signatureData,
            ...(details.executionNote ? { executionNote: details.executionNote } : {}),
            boxes: boxes.map((box) => ({
              id: box.id,
              boxNumber: box.boxNumber,
              title: box.title,
              location: box.location?.fullPath || null,
              apDecision: box.apDecision,
              apDecisionReference: box.apDecisionReference,
              apDecisionDate: box.apDecisionDate?.toISOString().slice(0, 10) || null,
              apDecisionReason: box.apDecisionReason,
              firstApprovedById: box.disposalFirstApprovedById,
              secondApprovedById: box.disposalSecondApprovedById,
              disposalCoolingOffUntil: box.disposalCoolingOffUntil?.toISOString() || null,
            })),
          },
        }],
      });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

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
