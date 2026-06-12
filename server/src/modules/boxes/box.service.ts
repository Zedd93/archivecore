import { prisma } from '../../config/database';
import { generateQrData } from '@archivecore/shared';
import { Prisma } from '@prisma/client';

function getBoxOrderBy(sortBy: string, sortOrder: Prisma.SortOrder): Prisma.BoxOrderByWithRelationInput {
  switch (sortBy) {
    case 'boxNumber': return { boxNumber: sortOrder };
    case 'title': return { title: sortOrder };
    case 'status': return { status: sortOrder };
    case 'docType': return { docType: sortOrder };
    case 'department': return { department: sortOrder };
    case 'location': return { location: { fullPath: sortOrder } };
    case 'folders': return { folders: { _count: sortOrder } };
    case 'createdAt':
    default:
      return { createdAt: sortOrder };
  }
}

export class BoxService {
  private async getLocationAndDescendantIds(locationId: string, tenantId: string): Promise<string[]> {
    const locations = await prisma.location.findMany({
      where: {
        isActive: true,
        OR: [{ tenantId }, { tenantId: null }],
      },
      select: { id: true, parentId: true },
    });

    if (!locations.some(location => location.id === locationId)) {
      const err = new Error('Lokalizacja nie znaleziona');
      (err as any).statusCode = 404;
      throw err;
    }

    const childrenByParent = new Map<string, string[]>();
    for (const location of locations) {
      if (!location.parentId) continue;
      const children = childrenByParent.get(location.parentId) ?? [];
      children.push(location.id);
      childrenByParent.set(location.parentId, children);
    }

    const result: string[] = [];
    const stack = [locationId];
    while (stack.length > 0) {
      const currentId = stack.pop()!;
      result.push(currentId);
      stack.push(...(childrenByParent.get(currentId) ?? []));
    }

    return result;
  }

  private async validateBoxLocation(locationId: string | undefined | null, tenantId: string) {
    if (!locationId) return;

    const location = await prisma.location.findFirst({
      where: {
        id: locationId,
        isActive: true,
        OR: [{ tenantId }, { tenantId: null }],
      },
      select: { type: true },
    });
    if (!location) {
      const err = new Error('Lokalizacja nie znaleziona');
      (err as any).statusCode = 404;
      throw err;
    }
    if (!['shelf', 'level', 'slot'].includes(location.type)) {
      const err = new Error('Karton można przypisać tylko do półki, poziomu albo pozycji. Wybierz konkretną lokalizację odkładczą.');
      (err as any).statusCode = 400;
      throw err;
    }
  }

  async list(tenantId: string, filters: any, skip: number, take: number, department?: string) {
    const where: Prisma.BoxWhereInput = { tenantId };
    const sortBy = String(filters.sortBy || 'createdAt');
    const sortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';
    const orderBy = getBoxOrderBy(sortBy, sortOrder);

    if (department) where.department = { equals: department, mode: 'insensitive' };
    if (filters.status) where.status = filters.status;
    if (filters.docType) where.docType = filters.docType;
    if (filters.locationId) {
      where.locationId = { in: await this.getLocationAndDescendantIds(String(filters.locationId), tenantId) };
    }
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
        orderBy,
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

  async getById(id: string, tenantId: string, department?: string) {
    const box = await prisma.box.findFirst({
      where: { id, tenantId, ...(department ? { department: { equals: department, mode: 'insensitive' } } : {}) },
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
    await this.validateBoxLocation(data.locationId, tenantId);

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
        department: data.department?.trim() || null,
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
    const box = await this.getById(id, tenantId); // Verify access
    await this.validateBoxLocation(data.locationId, tenantId);

    const updated = await prisma.box.update({
      where: { id },
      data: {
        title: data.title,
        docType: data.docType,
        department: data.department === undefined ? undefined : data.department.trim() || null,
        dateFrom: data.dateFrom ? new Date(data.dateFrom) : undefined,
        dateTo: data.dateTo ? new Date(data.dateTo) : undefined,
        keywords: data.keywords,
        locationId: data.locationId,
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

    if (data.locationId !== undefined && data.locationId !== box.locationId) {
      if (box.locationId) {
        await prisma.location.update({
          where: { id: box.locationId },
          data: { currentCount: { decrement: 1 } },
        });
      }
      if (data.locationId) {
        await prisma.location.update({
          where: { id: data.locationId },
          data: { currentCount: { increment: 1 } },
        });
      }
    }

    return updated;
  }

  async move(id: string, tenantId: string, locationId: string, notes?: string) {
    await this.validateBoxLocation(locationId, tenantId);

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
    await this.validateBoxLocation(locationId, tenantId);

    const boxes = await prisma.box.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, locationId: true },
    });
    const movedBoxes = boxes.filter(box => box.locationId !== locationId);

    const decrementByLocation = movedBoxes.reduce<Record<string, number>>((acc, box) => {
      if (!box.locationId) return acc;
      acc[box.locationId] = (acc[box.locationId] || 0) + 1;
      return acc;
    }, {});

    await prisma.$transaction([
      prisma.box.updateMany({
        where: { id: { in: movedBoxes.map(box => box.id) }, tenantId },
        data: { locationId },
      }),
      ...Object.entries(decrementByLocation).map(([oldLocationId, count]) =>
        prisma.location.update({
          where: { id: oldLocationId },
          data: { currentCount: { decrement: count } },
        })
      ),
      ...(movedBoxes.length > 0
        ? [
            prisma.location.update({
              where: { id: locationId },
              data: { currentCount: { increment: movedBoxes.length } },
            }),
          ]
        : []),
    ]);

    return { updated: boxes.length, moved: movedBoxes.length };
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
