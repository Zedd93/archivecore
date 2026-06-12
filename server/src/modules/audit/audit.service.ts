import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';

type AuditLike = {
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: Prisma.JsonValue | null;
  newValues: Prisma.JsonValue | null;
};

const ENTITY_DELEGATES: Record<string, string> = {
  box: 'box',
  document: 'document',
  folder: 'folder',
  location: 'location',
  retention_policy: 'retentionPolicy',
  transfer_list: 'transferList',
  transfer_list_item: 'transferListItem',
};

const REVERSIBLE_CREATE_ACTIONS = new Set([
  'box.create',
  'document.create',
  'folder.create',
  'location.create',
  'policy.create',
  'transfer_list.create',
  'transfer_list_item.create',
]);

const REVERSIBLE_UPDATE_ACTIONS = new Set([
  'box.update',
  'box.move',
  'box.status',
  'document.update',
  'folder.update',
  'location.update',
  'policy.update',
  'transfer_list.update',
  'transfer_list.status',
  'transfer_list_item.update',
  'transfer_list_item.bulk_assign_box',
]);

const REVERSIBLE_DELETE_ACTIONS = new Set([
  'document.delete',
  'transfer_list_item.delete',
]);

const SYSTEM_FIELDS = new Set(['createdAt', 'updatedAt']);

function getDelegate(entityType: string): any | null {
  const delegateName = ENTITY_DELEGATES[entityType];
  return delegateName ? (prisma as any)[delegateName] : null;
}

function getRevertSupport(log: AuditLike) {
  if (!log.entityId) return { canRevert: false, reason: 'Brak identyfikatora encji' };
  if (!getDelegate(log.entityType)) return { canRevert: false, reason: 'Ten typ zdarzenia nie obsługuje cofania' };

  if (REVERSIBLE_CREATE_ACTIONS.has(log.action)) {
    return { canRevert: Boolean(log.newValues), reason: log.newValues ? null : 'Brak danych utworzonej encji' };
  }
  if (REVERSIBLE_UPDATE_ACTIONS.has(log.action)) {
    return { canRevert: Boolean(log.oldValues), reason: log.oldValues ? null : 'Brak zapisanego stanu sprzed zmiany' };
  }
  if (REVERSIBLE_DELETE_ACTIONS.has(log.action)) {
    return { canRevert: Boolean(log.oldValues), reason: log.oldValues ? null : 'Brak danych usuniętej encji' };
  }

  return { canRevert: false, reason: 'Ta akcja nie obsługuje cofania' };
}

function toPlainData(value: any, includeId = false) {
  const source = JSON.parse(JSON.stringify(value || {}));
  const data: Record<string, any> = {};

  for (const [key, val] of Object.entries(source)) {
    if (!includeId && key === 'id') continue;
    if (SYSTEM_FIELDS.has(key) && !includeId) continue;
    data[key] = val;
  }

  return data;
}

async function ensureCreateRevertIsSafe(entityType: string, entityId: string) {
  if (entityType === 'transfer_list') {
    const count = await prisma.transferListItem.count({ where: { transferListId: entityId } });
    if (count > 0) throw Object.assign(new Error('Nie można cofnąć utworzenia spisu, który ma już pozycje'), { statusCode: 400 });
  }

  if (entityType === 'box') {
    const [folders, documents, attachments, orderItems, transferItems, hrFolders] = await Promise.all([
      prisma.folder.count({ where: { boxId: entityId } }),
      prisma.document.count({ where: { boxId: entityId } }),
      prisma.attachment.count({ where: { boxId: entityId } }),
      prisma.orderItem.count({ where: { boxId: entityId } }),
      prisma.transferListItem.count({ where: { boxId: entityId } }),
      prisma.hRFolder.count({ where: { boxId: entityId } }),
    ]);
    if (folders + documents + attachments + orderItems + transferItems + hrFolders > 0) {
      throw Object.assign(new Error('Nie można cofnąć utworzenia kartonu, który ma już powiązane dane'), { statusCode: 400 });
    }
  }

  if (entityType === 'folder') {
    const [documents, attachments, orderItems] = await Promise.all([
      prisma.document.count({ where: { folderId: entityId } }),
      prisma.attachment.count({ where: { folderId: entityId } }),
      prisma.orderItem.count({ where: { folderId: entityId } }),
    ]);
    if (documents + attachments + orderItems > 0) {
      throw Object.assign(new Error('Nie można cofnąć utworzenia teczki, która ma już powiązane dane'), { statusCode: 400 });
    }
  }

  if (entityType === 'location') {
    const [children, boxes] = await Promise.all([
      prisma.location.count({ where: { parentId: entityId } }),
      prisma.box.count({ where: { locationId: entityId } }),
    ]);
    if (children + boxes > 0) {
      throw Object.assign(new Error('Nie można cofnąć utworzenia lokalizacji, która ma podlokalizacje lub kartony'), { statusCode: 400 });
    }
  }

  if (entityType === 'retention_policy') {
    const boxes = await prisma.box.count({ where: { retentionPolicyId: entityId } });
    if (boxes > 0) {
      throw Object.assign(new Error('Nie można cofnąć utworzenia polityki retencji używanej przez kartony'), { statusCode: 400 });
    }
  }
}

export class AuditService {
  async list(tenantId: string | null, filters: any, skip: number, take: number) {
    const where: Prisma.AuditLogWhereInput = {};
    if (tenantId) where.tenantId = tenantId;
    if (filters.userId) where.userId = filters.userId;
    if (filters.action) where.action = filters.action;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.dateFrom) where.createdAt = { ...where.createdAt as any, gte: new Date(filters.dateFrom) };
    if (filters.dateTo) where.createdAt = { ...where.createdAt as any, lte: new Date(filters.dateTo) };

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          tenant: { select: { id: true, name: true, shortCode: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { data: data.map(log => ({ ...log, ...getRevertSupport(log) })), total };
  }

  async getById(id: string) {
    const log = await prisma.auditLog.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        tenant: { select: { id: true, name: true } },
      },
    });
    if (!log) throw Object.assign(new Error('Log nie znaleziony'), { statusCode: 404 });
    return { ...log, ...getRevertSupport(log) };
  }

  async getActions() {
    const actions = await prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    return actions.map(a => a.action);
  }

  async getEntityTypes() {
    const types = await prisma.auditLog.findMany({
      distinct: ['entityType'],
      select: { entityType: true },
      orderBy: { entityType: 'asc' },
    });
    return types.map(t => t.entityType);
  }

  async revert(id: string, actorUserId: string) {
    const log = await this.getById(id);
    const support = getRevertSupport(log);
    if (!support.canRevert) {
      throw Object.assign(new Error(support.reason || 'Tego wpisu audytu nie da się cofnąć'), { statusCode: 400 });
    }

    const delegate = getDelegate(log.entityType);
    if (!delegate) {
      throw Object.assign(new Error('Ten typ encji nie obsługuje cofania'), { statusCode: 400 });
    }
    const entityId = log.entityId;
    if (!entityId) {
      throw Object.assign(new Error('Brak identyfikatora encji'), { statusCode: 400 });
    }

    let revertedEntity: any;
    let revertType: 'delete_created' | 'restore_previous' | 'recreate_deleted';

    if (REVERSIBLE_CREATE_ACTIONS.has(log.action)) {
      await ensureCreateRevertIsSafe(log.entityType, entityId);
      revertedEntity = await delegate.delete({ where: { id: entityId } });
      revertType = 'delete_created';
    } else if (REVERSIBLE_UPDATE_ACTIONS.has(log.action)) {
      revertedEntity = await delegate.update({
        where: { id: entityId },
        data: toPlainData(log.oldValues),
      });
      revertType = 'restore_previous';
    } else if (REVERSIBLE_DELETE_ACTIONS.has(log.action)) {
      revertedEntity = await delegate.create({
        data: toPlainData(log.oldValues, true),
      });
      revertType = 'recreate_deleted';
    } else {
      throw Object.assign(new Error('Ta akcja nie obsługuje cofania'), { statusCode: 400 });
    }

    await prisma.auditLog.create({
      data: {
        tenantId: log.tenantId || undefined,
        userId: actorUserId,
        action: 'audit.revert',
        entityType: log.entityType,
        entityId: log.entityId || undefined,
        oldValues: log.newValues || undefined,
        newValues: {
          revertedAuditLogId: log.id,
          revertedAction: log.action,
          revertType,
          entity: JSON.parse(JSON.stringify(revertedEntity)),
        },
      },
    });

    return { reverted: true, revertType, entity: revertedEntity };
  }
}

export const auditService = new AuditService();
