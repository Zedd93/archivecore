import { prisma } from '../../config/database';
import { CustodyEventType } from '@prisma/client';

export class CustodyService {
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
    // Verify box belongs to the tenant
    const box = await prisma.box.findFirst({
      where: { id: data.boxId, tenantId },
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
    }

    return prisma.custodyEvent.create({
      data: {
        orderId: data.orderId,
        boxId: data.boxId,
        eventType: data.eventType,
        fromUserId: data.fromUserId,
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

  async getByBox(boxId: string, tenantId: string) {
    // Verify box belongs to tenant
    const box = await prisma.box.findFirst({
      where: { id: boxId, tenantId },
      select: { id: true },
    });
    if (!box) {
      throw Object.assign(new Error('Box not found or access denied'), { statusCode: 404 });
    }

    return prisma.custodyEvent.findMany({
      where: { boxId },
      orderBy: { eventAt: 'desc' },
      include: {
        fromUser: { select: { id: true, firstName: true, lastName: true } },
        toUser: { select: { id: true, firstName: true, lastName: true } },
        fromLocation: { select: { id: true, fullPath: true, code: true } },
        toLocation: { select: { id: true, fullPath: true, code: true } },
        order: { select: { id: true, orderNumber: true, orderType: true } },
      },
    });
  }

  async getByOrder(orderId: string, tenantId: string) {
    // Verify order belongs to tenant
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true },
    });
    if (!order) {
      throw Object.assign(new Error('Order not found or access denied'), { statusCode: 404 });
    }

    return prisma.custodyEvent.findMany({
      where: { orderId },
      orderBy: { eventAt: 'desc' },
      include: {
        box: { select: { id: true, boxNumber: true, title: true } },
        fromUser: { select: { id: true, firstName: true, lastName: true } },
        toUser: { select: { id: true, firstName: true, lastName: true } },
        fromLocation: { select: { id: true, fullPath: true, code: true } },
        toLocation: { select: { id: true, fullPath: true, code: true } },
      },
    });
  }
}

export const custodyService = new CustodyService();
