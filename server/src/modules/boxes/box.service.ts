import { prisma } from '../../config/database';
import { generateQrData } from '@archivecore/shared';
import { Prisma } from '@prisma/client';

export class BoxService {
  async list(tenantId: string, filters: any, skip: number, take: number) {
    const where: Prisma.BoxWhereInput = { tenantId };

    if (filters.status) where.status = filters.status;
    if (filters.docType) where.docType = filters.docType;
    if (filters.locationId) where.locationId = filters.locationId;
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { boxNumber: { contains: filters.search, mode: 'insensitive' } },
        { qrCode: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.box.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          location: { select: { id: true, fullPath: true, code: true } },
          tenant: { select: { id: true, name: true, shortCode: true } },
          _count: { select: { folders: true, documents: true, attachments: true, transferListItems: true } },
        },
      }),
      prisma.box.count({ where }),
    ]);

    return { data, total };
  }

  async getById(id: string, tenantId: string) {
    const box = await prisma.box.findFirst({
      where: { id, tenantId },
      include: {
        location: { select: { id: true, fullPath: true, code: true, name: true } },
        tenant: { select: { id: true, name: true, shortCode: true } },
        folders: { orderBy: { orderInBox: 'asc' } },
        transferListItems: {
          orderBy: { ordinalNumber: 'asc' },
          include: {
            transferList: { select: { id: true, listNumber: true, title: true } },
          },
        },
        _count: { select: { folders: true, documents: true, attachments: true, transferListItems: true } },
      },
    });
    if (!box) throw Object.assign(new Error('Karton nie znaleziony'), { statusCode: 404 });
    return box;
  }

  async create(data: any, tenantId: string, userId: string) {
    // Get tenant for QR code generation
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw Object.assign(new Error('Tenant nie znaleziony'), { statusCode: 404 });

    // Generate box number (auto-increment per tenant per year)
    const year = new Date().getFullYear();
    const lastBox = await prisma.box.findFirst({
      where: { tenantId, boxNumber: { startsWith: `K-${year}-` } },
      orderBy: { boxNumber: 'desc' },
    });
    const seq = lastBox ? parseInt(lastBox.boxNumber.split('-')[2]) + 1 : 1;
    const boxNumber = `K-${year}-${seq.toString().padStart(6, '0')}`;
    const qrCode = generateQrData(tenant.shortCode, boxNumber);

    const box = await prisma.box.create({
      data: {
        tenantId,
        title: data.title,
        boxNumber,
        qrCode,
        docType: data.docType,
        dateFrom: data.dateFrom ? new Date(data.dateFrom) : undefined,
        dateTo: data.dateTo ? new Date(data.dateTo) : undefined,
        keywords: data.keywords || [],
        locationId: data.locationId,
        retentionPolicyId: data.retentionPolicyId,
        notes: data.notes,
        description: data.description,
        customFields: data.customFields,
        createdById: userId,
        status: 'active',
      },
      include: {
        location: { select: { id: true, fullPath: true, code: true } },
        tenant: { select: { id: true, name: true, shortCode: true } },
      },
    });

    // Update location counter
    if (data.locationId) {
      await prisma.location.update({
        where: { id: data.locationId },
        data: { currentCount: { increment: 1 } },
      });
    }

    return box;
  }

  async update(id: string, tenantId: string, data: any) {
    await this.getById(id, tenantId); // Verify access
    return prisma.box.update({
      where: { id },
      data: {
        title: data.title,
        docType: data.docType,
        dateFrom: data.dateFrom ? new Date(data.dateFrom) : undefined,
        dateTo: data.dateTo ? new Date(data.dateTo) : undefined,
        keywords: data.keywords,
        notes: data.notes,
        description: data.description,
        customFields: data.customFields,
        barcode: data.barcode,
      },
      include: {
        location: { select: { id: true, fullPath: true, code: true } },
        tenant: { select: { id: true, name: true, shortCode: true } },
      },
    });
  }

  async move(id: string, tenantId: string, locationId: string, notes?: string) {
    const box = await this.getById(id, tenantId);
    const oldLocationId = box.locationId;

    const updated = await prisma.box.update({
      where: { id },
      data: { locationId },
      include: {
        location: { select: { id: true, fullPath: true, code: true } },
      },
    });

    // Update location counters
    if (oldLocationId) {
      await prisma.location.update({
        where: { id: oldLocationId },
        data: { currentCount: { decrement: 1 } },
      });
    }
    await prisma.location.update({
      where: { id: locationId },
      data: { currentCount: { increment: 1 } },
    });

    return updated;
  }

  async changeStatus(id: string, tenantId: string, status: string) {
    await this.getById(id, tenantId);
    return prisma.box.update({
      where: { id },
      data: { status: status as any },
    });
  }

  async bulkChangeStatus(ids: string[], tenantId: string, status: string) {
    const result = await prisma.box.updateMany({
      where: { id: { in: ids }, tenantId },
      data: { status: status as any },
    });
    return { updated: result.count };
  }

  async bulkMove(ids: string[], tenantId: string, locationId: string) {
    const result = await prisma.box.updateMany({
      where: { id: { in: ids }, tenantId },
      data: { locationId },
    });
    // Update location counter
    await prisma.location.update({
      where: { id: locationId },
      data: { currentCount: { increment: result.count } },
    });
    return { updated: result.count };
  }

  async getHistory(id: string, tenantId: string) {
    await this.getById(id, tenantId);
    const [auditLogs, custodyEvents] = await Promise.all([
      prisma.auditLog.findMany({
        where: { entityType: 'box', entityId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
      }),
      prisma.custodyEvent.findMany({
        where: { boxId: id },
        orderBy: { eventAt: 'desc' },
        include: {
          fromUser: { select: { firstName: true, lastName: true } },
          toUser: { select: { firstName: true, lastName: true } },
          fromLocation: { select: { fullPath: true } },
          toLocation: { select: { fullPath: true } },
        },
      }),
    ]);
    return { auditLogs, custodyEvents };
  }
}

export const boxService = new BoxService();
