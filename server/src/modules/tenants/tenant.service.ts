import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';

export class TenantService {
  async list(filters: any, skip: number, take: number) {
    const where: Prisma.TenantWhereInput = {};
    if (filters.isActive !== undefined) where.isActive = filters.isActive === 'true';
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { shortCode: { contains: filters.search, mode: 'insensitive' } },
        { nip: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: { users: true, boxes: true, hrFolders: true, orders: true },
          },
        },
      }),
      prisma.tenant.count({ where }),
    ]);

    return { data, total };
  }

  async getById(id: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, boxes: true, hrFolders: true, orders: true, locations: true },
        },
      },
    });
    if (!tenant) throw Object.assign(new Error('Tenant nie znaleziony'), { statusCode: 404 });
    return tenant;
  }

  async create(data: any) {
    // Check duplicate shortCode
    const existing = await prisma.tenant.findUnique({ where: { shortCode: data.shortCode } });
    if (existing) throw Object.assign(new Error('ShortCode już istnieje'), { statusCode: 409 });

    return prisma.tenant.create({
      data: {
        name: data.name,
        shortCode: data.shortCode,
        nip: data.nip,
        address: data.address,
        contactPerson: data.contactPerson,
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        isActive: data.isActive ?? true,
        configJson: data.configJson,
      },
    });
  }

  async update(id: string, data: any) {
    await this.getById(id);
    return prisma.tenant.update({
      where: { id },
      data: {
        name: data.name,
        nip: data.nip,
        address: data.address,
        contactPerson: data.contactPerson,
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        isActive: data.isActive,
        configJson: data.configJson,
      },
    });
  }

  async getStats(id: string) {
    const [boxCount, hrCount, orderCount, userCount, recentOrders, storageByDocType] = await Promise.all([
      prisma.box.count({ where: { tenantId: id } }),
      prisma.hRFolder.count({ where: { tenantId: id } }),
      prisma.order.count({ where: { tenantId: id } }),
      prisma.user.count({ where: { tenantId: id } }),
      prisma.order.findMany({
        where: { tenantId: id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, orderNumber: true, status: true, orderType: true, createdAt: true },
      }),
      prisma.box.groupBy({
        by: ['docType'],
        where: { tenantId: id },
        _count: true,
        orderBy: { _count: { docType: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      boxCount,
      hrCount,
      orderCount,
      userCount,
      recentOrders,
      storageByDocType,
    };
  }
}

export const tenantService = new TenantService();
