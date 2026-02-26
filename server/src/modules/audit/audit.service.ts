import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';

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

    return { data, total };
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
    return log;
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
}

export const auditService = new AuditService();
