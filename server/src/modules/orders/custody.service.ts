import { prisma } from '../../config/database';
import { CustodyEventType, Prisma } from '@prisma/client';

export class CustodyService {
  private async validateTargetLocation(locationId: string | undefined, tenantId: string) {
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
      throw Object.assign(new Error('Lokalizacja docelowa nie istnieje albo nie masz do niej dostępu'), { statusCode: 404 });
    }

    if (!['shelf', 'level', 'slot'].includes(location.type)) {
      throw Object.assign(
        new Error('Lokalizacja docelowa musi wskazywać półkę, poziom albo pozycję, a nie magazyn, strefę albo regał'),
        { statusCode: 400 }
      );
    }
  }

  async create(data: {
    orderId?: string;
    boxId: string;
    eventType: CustodyEventType;
    fromUserId?: string;
    toUserId?: string;
    fromLocationId?: string;
    toLocationId?: string;
    signatureData?: string;
    notes?: string;
  }, tenantId: string) {
    await this.validateTargetLocation(data.toLocationId, tenantId);

    // Verify box belongs to the tenant
    const box = await prisma.box.findFirst({
      where: { id: data.boxId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!box) {
      throw Object.assign(new Error('Box not found or access denied'), { statusCode: 404 });
    }

    // If orderId provided, verify it belongs to the tenant
    if (data.orderId) {
      const order = await prisma.order.findFirst({
        where: { id: data.orderId, tenantId },
        select: { id: true },
      });
      if (!order) {
        throw Object.assign(new Error('Order not found or access denied'), { statusCode: 404 });
      }
      const item = await prisma.orderItem.findFirst({
        where: { orderId: data.orderId, boxId: data.boxId },
        select: { id: true },
      });
      if (!item) {
        throw Object.assign(new Error('Karton nie jest bezpośrednią pozycją tego zlecenia'), { statusCode: 400 });
      }
    }

    if (data.toUserId) {
      const recipient = await prisma.user.findFirst({
        where: { id: data.toUserId, OR: [{ tenantId }, { tenantId: null }] },
        select: { id: true },
      });
      if (!recipient) throw Object.assign(new Error('Odbiorca nie należy do tenanta'), { statusCode: 400 });
    }

    return prisma.custodyEvent.create({
      data: {
        orderId: data.orderId,
        boxId: data.boxId,
        eventType: data.eventType,
        fromUserId: data.fromUserId,
        performedById: data.fromUserId,
        toUserId: data.toUserId,
        fromLocationId: data.fromLocationId,
        toLocationId: data.toLocationId,
        signatureData: data.signatureData,
        notes: data.notes,
      },
      include: {
        fromUser: { select: { id: true, firstName: true, lastName: true } },
        toUser: { select: { id: true, firstName: true, lastName: true } },
        fromLocation: { select: { id: true, fullPath: true, code: true } },
        toLocation: { select: { id: true, fullPath: true, code: true } },
      },
    });
  }

  async getTransfersByBox(boxId: string, tenantId: string, department?: string) {
    // Verify box belongs to tenant
    const box = await prisma.box.findFirst({
      where: {
        id: boxId, tenantId, deletedAt: null,
        ...(department ? { department: { equals: department, mode: 'insensitive' as const } } : {}),
      },
      select: { id: true },
    });
    if (!box) {
      throw Object.assign(new Error('Box not found or access denied'), { statusCode: 404 });
    }

    return prisma.custodyEvent.findMany({
      where: { boxId, eventType: 'transfer' },
      orderBy: { eventAt: 'desc' },
      take: 50,
      include: {
        fromUser: { select: { id: true, firstName: true, lastName: true } },
        toUser: { select: { id: true, firstName: true, lastName: true } },
        fromLocation: { select: { id: true, fullPath: true, code: true } },
        toLocation: { select: { id: true, fullPath: true, code: true } },
        order: { select: { id: true, orderNumber: true, orderType: true } },
      },
    });
  }

  async getByOrder(orderId: string, tenantId: string, department?: string) {
    // Verify order belongs to tenant
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true },
    });
    if (!order) {
      throw Object.assign(new Error('Order not found or access denied'), { statusCode: 404 });
    }

    const departmentFilter: Prisma.CustodyEventWhereInput = department ? {
      OR: [
        { box: { department: { equals: department, mode: 'insensitive' } } },
        { folder: { box: { department: { equals: department, mode: 'insensitive' } } } },
        { document: { OR: [
          { box: { department: { equals: department, mode: 'insensitive' } } },
          { folder: { box: { department: { equals: department, mode: 'insensitive' } } } },
        ] } },
      ],
    } : {};
    return prisma.custodyEvent.findMany({
      where: { orderId, ...departmentFilter },
      orderBy: { eventAt: 'desc' },
      select: {
        id: true, eventType: true, eventAt: true, notes: true,
        boxId: true, folderId: true, documentId: true, hrFolderId: true,
        recipientName: true,
        performedBy: { select: { id: true, firstName: true, lastName: true } },
        box: { select: { id: true, boxNumber: true, title: true } },
        folder: { select: { id: true, folderNumber: true, title: true } },
        document: { select: { id: true, title: true } },
        hrFolder: { select: { id: true, employeeFirstName: true, employeeLastName: true } },
        fromUser: { select: { id: true, firstName: true, lastName: true } },
        toUser: { select: { id: true, firstName: true, lastName: true } },
        fromLocation: { select: { id: true, fullPath: true, code: true } },
        toLocation: { select: { id: true, fullPath: true, code: true } },
      },
    });
  }
}

export const custodyService = new CustodyService();
