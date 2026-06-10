import { prisma } from '../../config/database';
import { Prisma, OrderStatus, OrderType, OrderPriority, OrderItemStatus } from '@prisma/client';
import { isValidTransition } from './order-state-machine';
import { SLA_LEVELS, BUSINESS_HOURS, Permissions, ORDER_STATUS_LABELS } from '@archivecore/shared';
import { notificationService } from '../notifications/notification.service';

function calculateSlaDeadline(priority: string): Date {
  const slaMap: Record<string, number> = {
    normal: SLA_LEVELS[0].hours,
    high: SLA_LEVELS[1].hours,
    urgent: SLA_LEVELS[2].hours,
  };
  const hours = slaMap[priority] || 24;
  const now = new Date();
  let remaining = hours;
  const current = new Date(now);

  while (remaining > 0) {
    current.setHours(current.getHours() + 1);
    const day = current.getDay();
    const hour = current.getHours();
    if (BUSINESS_HOURS.workDays.includes(day) && hour >= BUSINESS_HOURS.startHour && hour < BUSINESS_HOURS.endHour) {
      remaining--;
    }
  }
  return current;
}

export class OrderService {
  private async notifyOrderStatus(order: any, newStatus: OrderStatus, actorId: string) {
    const permissionsByStatus: Partial<Record<OrderStatus, (typeof Permissions)[keyof typeof Permissions][]>> = {
      submitted: [Permissions.ORDER_APPROVE],
      approved: [Permissions.ORDER_PROCESS],
      in_progress: [Permissions.ORDER_PROCESS],
      ready: [Permissions.ORDER_PROCESS],
      delivered: [Permissions.ORDER_COMPLETE],
      completed: [Permissions.ORDER_READ],
      rejected: [Permissions.ORDER_READ],
      cancelled: [Permissions.ORDER_READ],
    };
    const requiredPermissions = permissionsByStatus[newStatus] ?? [Permissions.ORDER_READ];

    await notificationService.notifyTenantUsers({
      tenantId: order.tenantId,
      requiredPermissions,
      includeUserIds: [order.requestedBy, order.assignedTo, order.approvedBy].filter(Boolean),
      excludeUserIds: [actorId],
      type: 'order_status',
      title: `Zlecenie ${order.orderNumber}: ${ORDER_STATUS_LABELS[newStatus] || newStatus}`,
      message: `Status zlecenia ${order.orderNumber} zmieniono na "${ORDER_STATUS_LABELS[newStatus] || newStatus}".`,
      entityType: 'order',
      entityId: order.id,
      actionUrl: `/orders/${order.id}`,
    });
  }

  private getStatusUpdateData(order: any, newStatus: OrderStatus, userId: string, notes?: string): Prisma.OrderUpdateInput {
    const updateData: Prisma.OrderUpdateInput = {
      status: newStatus,
      notes: notes || order.notes,
    };

    switch (newStatus) {
      case 'approved':
        updateData.approver = { connect: { id: userId } };
        break;
      case 'in_progress':
        updateData.assignee = { connect: { id: userId } };
        break;
      case 'completed':
        updateData.completedAt = new Date();
        break;
    }

    return updateData;
  }

  private async resolveOrderItem(item: any, tenantId: string, department?: string) {
    if (item.boxId || item.boxNumber) {
      const box = await prisma.box.findFirst({
        where: {
          tenantId,
          ...(item.boxId ? { id: item.boxId } : { boxNumber: item.boxNumber }),
          ...(department ? { department: { equals: department, mode: 'insensitive' } } : {}),
        },
        select: { id: true },
      });

      if (!box) {
        throw Object.assign(new Error('Karton nie istnieje albo nie masz do niego dostępu'), { statusCode: 404 });
      }

      return {
        boxId: box.id,
        itemStatus: OrderItemStatus.pending,
      };
    }

    return {
      folderId: item.folderId,
      hrFolderId: item.hrFolderId,
      itemStatus: OrderItemStatus.pending,
    };
  }

  async list(tenantId: string, filters: any, skip: number, take: number) {
    const where: Prisma.OrderWhereInput = { tenantId };

    if (filters.status) where.status = filters.status as OrderStatus;
    if (filters.orderType) where.orderType = filters.orderType as OrderType;
    if (filters.priority) where.priority = filters.priority as OrderPriority;
    if (filters.requestedBy) where.requestedBy = filters.requestedBy;
    if (filters.assignedTo) where.assignedTo = filters.assignedTo;
    if (filters.search) {
      where.OR = [
        { orderNumber: { contains: filters.search, mode: 'insensitive' } },
        { notes: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          requester: { select: { id: true, firstName: true, lastName: true, email: true } },
          approver: { select: { id: true, firstName: true, lastName: true } },
          assignee: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { items: true } },
        },
      }),
      prisma.order.count({ where }),
    ]);

    return { data, total };
  }

  async getById(id: string, tenantId: string) {
    const order = await prisma.order.findFirst({
      where: { id, tenantId },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true, email: true } },
        approver: { select: { id: true, firstName: true, lastName: true } },
        assignee: { select: { id: true, firstName: true, lastName: true } },
        items: {
          include: {
            box: { select: { id: true, boxNumber: true, title: true, status: true, qrCode: true, locationId: true, location: { select: { fullPath: true } } } },
            folder: { select: { id: true, folderNumber: true, title: true } },
            hrFolder: { select: { id: true, employeeFirstName: true, employeeLastName: true } },
            picker: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        custodyEvents: {
          orderBy: { eventAt: 'desc' },
          take: 20,
          include: {
            fromUser: { select: { firstName: true, lastName: true } },
            toUser: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!order) throw Object.assign(new Error('Zlecenie nie znalezione'), { statusCode: 404 });
    return order;
  }

  async create(data: any, tenantId: string, userId: string, department?: string) {
    // Generate order number
    const year = new Date().getFullYear();
    const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
    const lastOrder = await prisma.order.findFirst({
      where: { tenantId, orderNumber: { startsWith: `Z-${year}${month}-` } },
      orderBy: { orderNumber: 'desc' },
    });
    const seq = lastOrder ? parseInt(lastOrder.orderNumber.split('-')[2]) + 1 : 1;
    const orderNumber = `Z-${year}${month}-${seq.toString().padStart(5, '0')}`;

    // Calculate SLA deadline
    const slaDeadline = calculateSlaDeadline(data.priority || 'normal');
    const resolvedItems = await Promise.all(
      data.items.map((item: any) => this.resolveOrderItem(item, tenantId, department))
    );

    const order = await prisma.order.create({
      data: {
        tenantId,
        orderNumber,
        orderType: data.orderType,
        priority: data.priority || 'normal',
        status: 'draft',
        requestedBy: userId,
        slaDeadline,
        notes: data.notes,
        items: {
          create: resolvedItems,
        },
      },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true } },
        items: true,
        _count: { select: { items: true } },
      },
    });

    return order;
  }

  async addItem(orderId: string, tenantId: string, item: any, department?: string) {
    const order = await this.getById(orderId, tenantId);
    if (['completed', 'cancelled'].includes(order.status)) {
      throw Object.assign(new Error('Nie można dodawać pozycji do zakończonego albo anulowanego zlecenia'), { statusCode: 400 });
    }

    const resolvedItem = await this.resolveOrderItem(item, tenantId, department);
    return prisma.orderItem.create({
      data: {
        orderId,
        ...resolvedItem,
      },
      include: {
        box: { select: { id: true, boxNumber: true, title: true, status: true, qrCode: true, locationId: true, location: { select: { fullPath: true } } } },
        folder: { select: { id: true, folderNumber: true, title: true } },
        hrFolder: { select: { id: true, employeeFirstName: true, employeeLastName: true } },
        picker: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async updateStatus(id: string, tenantId: string, newStatus: OrderStatus, userId: string, notes?: string) {
    const order = await this.getById(id, tenantId);

    if (!isValidTransition(order.status as OrderStatus, newStatus)) {
      throw Object.assign(
        new Error(`Niedozwolona zmiana statusu z "${order.status}" na "${newStatus}"`),
        { statusCode: 400 }
      );
    }

    const updateData = this.getStatusUpdateData(order, newStatus, userId, notes);

    const updated = await prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        requester: { select: { id: true, firstName: true, lastName: true } },
        approver: { select: { id: true, firstName: true, lastName: true } },
        assignee: { select: { id: true, firstName: true, lastName: true } },
        items: true,
      },
    });

    await this.notifyOrderStatus(updated, newStatus, userId);

    return updated;
  }

  async submit(id: string, tenantId: string, userId: string) {
    return this.updateStatus(id, tenantId, 'submitted', userId);
  }

  async approve(id: string, tenantId: string, userId: string) {
    return this.updateStatus(id, tenantId, 'approved', userId);
  }

  async reject(id: string, tenantId: string, userId: string, notes?: string) {
    return this.updateStatus(id, tenantId, 'rejected', userId, notes);
  }

  async startProcessing(id: string, tenantId: string, userId: string) {
    return this.updateStatus(id, tenantId, 'in_progress', userId);
  }

  async markReady(id: string, tenantId: string, userId: string) {
    return this.updateStatus(id, tenantId, 'ready', userId);
  }

  async deliver(id: string, tenantId: string, userId: string) {
    const order = await this.getById(id, tenantId);
    if (!isValidTransition(order.status as OrderStatus, 'delivered')) {
      throw Object.assign(
        new Error(`Niedozwolona zmiana statusu z "${order.status}" na "delivered"`),
        { statusCode: 400 }
      );
    }

    const deliveredAt = new Date();
    const nextItemStatus = order.orderType === 'return_order' ? OrderItemStatus.returned : OrderItemStatus.delivered;
    const boxIds = order.items.map((item: any) => item.boxId).filter(Boolean);
    const boxStatus = order.orderType === 'checkout'
      ? 'checked_out'
      : order.orderType === 'return_order'
        ? 'active'
        : undefined;

    const operations: Prisma.PrismaPromise<any>[] = [
      prisma.order.update({
        where: { id },
        data: this.getStatusUpdateData(order, 'delivered', userId),
      }),
      prisma.orderItem.updateMany({
        where: {
          orderId: id,
          itemStatus: { in: [OrderItemStatus.pending, OrderItemStatus.picked] },
        },
        data: {
          itemStatus: nextItemStatus,
          deliveredAt,
        },
      }),
    ];

    if (boxIds.length > 0) {
      operations.push(
        prisma.custodyEvent.createMany({
          data: boxIds.map((boxId: string) => ({
            orderId: id,
            boxId,
            eventType: order.orderType === 'return_order' ? 'return_event' : 'handover',
            fromUserId: userId,
            toUserId: order.requestedBy,
          })),
        })
      );
    }

    if (boxIds.length > 0 && boxStatus) {
      operations.push(
        prisma.box.updateMany({
          where: { id: { in: boxIds }, tenantId },
          data: { status: boxStatus },
        })
      );
    }

    await prisma.$transaction(operations);
    await this.notifyOrderStatus(order, 'delivered', userId);

    return this.getById(id, tenantId);
  }

  async complete(id: string, tenantId: string, userId: string) {
    await this.updateStatus(id, tenantId, 'completed', userId);

    // Mark all pending/picked items as delivered
    await prisma.orderItem.updateMany({
      where: {
        orderId: id,
        itemStatus: { in: [OrderItemStatus.pending, OrderItemStatus.picked] },
      },
      data: {
        itemStatus: OrderItemStatus.delivered,
        deliveredAt: new Date(),
      },
    });

    return this.getById(id, tenantId);
  }

  async cancel(id: string, tenantId: string, userId: string, notes?: string) {
    return this.updateStatus(id, tenantId, 'cancelled', userId, notes);
  }

  async updateItemStatus(orderId: string, itemId: string, tenantId: string, status: string, userId: string) {
    const order = await this.getById(orderId, tenantId);
    const item = order.items.find((i: any) => i.id === itemId);
    if (!item) throw Object.assign(new Error('Pozycja nie znaleziona'), { statusCode: 404 });

    return prisma.orderItem.update({
      where: { id: itemId },
      data: {
        itemStatus: status as any,
        pickedById: status === 'picked' ? userId : undefined,
        pickedAt: status === 'picked' ? new Date() : undefined,
        deliveredAt: status === 'delivered' ? new Date() : undefined,
      },
    });
  }

  async assign(id: string, tenantId: string, assigneeId: string) {
    await this.getById(id, tenantId);
    return prisma.order.update({
      where: { id },
      data: { assignedTo: assigneeId },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async getOverdueSla(tenantId: string) {
    return prisma.order.findMany({
      where: {
        tenantId,
        status: { notIn: ['completed', 'cancelled'] },
        slaDeadline: { lt: new Date() },
      },
      orderBy: { slaDeadline: 'asc' },
      include: {
        requester: { select: { firstName: true, lastName: true } },
        assignee: { select: { firstName: true, lastName: true } },
        _count: { select: { items: true } },
      },
    });
  }
}

export const orderService = new OrderService();
