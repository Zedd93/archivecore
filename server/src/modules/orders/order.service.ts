import { prisma } from '../../config/database';
import { Prisma, OrderStatus, OrderType, OrderPriority, OrderItemStatus } from '@prisma/client';
import { isValidTransition } from './order-state-machine';
import { SLA_LEVELS, BUSINESS_HOURS, Permissions, ORDER_STATUS_LABELS } from '@archivecore/shared';
import { notificationService } from '../notifications/notification.service';

function calculateSlaDeadline(priority: string): Date {
  const slaMap: Record<string, number> = {
    normal: SLA_LEVELS.find(level => level.code === 'normal')?.hours || 48,
    high: SLA_LEVELS.find(level => level.code === 'high')?.hours || 24,
    urgent: SLA_LEVELS.find(level => level.code === 'urgent')?.hours || 8,
  };
  const hours = slaMap[priority] || 48;
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

function parseExpectedReturnAt(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T12:00:00.000Z`)
    : new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error('Nieprawidłowa planowana data zwrotu'), { statusCode: 400 });
  }

  return date;
}

function getMonthlyOrderNumberPrefix(date = new Date()) {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `Z-${year}${month}-`;
}

function parseOrderNumberSequence(orderNumber: string, prefix: string) {
  if (!orderNumber.startsWith(prefix)) return 0;
  const sequence = Number.parseInt(orderNumber.slice(prefix.length), 10);
  return Number.isFinite(sequence) ? sequence : 0;
}

function isPrismaUniqueError(err: unknown, field?: string) {
  const anyErr = err as any;
  if (anyErr?.code !== 'P2002') return false;
  if (!field) return true;

  const target = anyErr.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  return String(target || anyErr.message || '').includes(field);
}

export class OrderService {
  private getOrderItemBoxId(item: any): string | null {
    return item.boxId
      || item.box?.id
      || item.folder?.box?.id
      || item.document?.box?.id
      || item.document?.folder?.box?.id
      || item.transferListItem?.box?.id
      || item.hrFolder?.box?.id
      || null;
  }

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

    if (item.documentId) {
      const document = await prisma.document.findFirst({
        where: {
          id: item.documentId,
          tenantId,
          ...(department ? {
            OR: [
              { box: { department: { equals: department, mode: 'insensitive' } } },
              { folder: { box: { department: { equals: department, mode: 'insensitive' } } } },
            ],
          } : {}),
        },
        select: { id: true },
      });

      if (!document) {
        throw Object.assign(new Error('Dokument nie istnieje albo nie masz do niego dostępu'), { statusCode: 404 });
      }

      return {
        documentId: document.id,
        itemStatus: OrderItemStatus.pending,
      };
    }

    if (item.folderId) {
      const folder = await prisma.folder.findFirst({
        where: {
          id: item.folderId,
          tenantId,
          ...(department ? { box: { department: { equals: department, mode: 'insensitive' } } } : {}),
        },
        select: { id: true },
      });

      if (!folder) {
        throw Object.assign(new Error('Teczka nie istnieje albo nie masz do niej dostępu'), { statusCode: 404 });
      }

      return {
        folderId: folder.id,
        itemStatus: OrderItemStatus.pending,
      };
    }

    if (item.transferListItemId) {
      const transferListItem = await prisma.transferListItem.findFirst({
        where: {
          id: item.transferListItemId,
          transferList: { tenantId },
          ...(department ? {
            box: {
              is: { department: { equals: department, mode: 'insensitive' } },
            },
          } : {}),
        },
        select: { id: true },
      });

      if (!transferListItem) {
        throw Object.assign(new Error('Pozycja spisu nie istnieje albo nie masz do niej dostępu'), { statusCode: 404 });
      }

      return {
        transferListItemId: transferListItem.id,
        itemStatus: OrderItemStatus.pending,
      };
    }

    if (item.hrFolderId) {
      const hrFolder = await prisma.hRFolder.findFirst({
        where: {
          id: item.hrFolderId,
          tenantId,
        },
        select: { id: true },
      });

      if (!hrFolder) {
        throw Object.assign(new Error('Akta osobowe nie istnieją albo nie masz do nich dostępu'), { statusCode: 404 });
      }

      return {
        hrFolderId: hrFolder.id,
        itemStatus: OrderItemStatus.pending,
      };
    }

    throw Object.assign(new Error('Pozycja zlecenia musi wskazywać karton, teczkę, dokument, pozycję spisu albo akta osobowe'), { statusCode: 400 });
  }

  private async resolveOrderItems(items: any[], tenantId: string, department?: string) {
    const resolvedItems = await Promise.all(
      items.map((item: any) => this.resolveOrderItem(item, tenantId, department))
    );

    if (resolvedItems.length === 0) {
      throw Object.assign(new Error('Zlecenie musi zawierać co najmniej jedną pozycję'), { statusCode: 400 });
    }

    return resolvedItems;
  }

  private getCreateOrderMigrationHint(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes('transferListItemId') ||
      message.includes('order_items_transferListItemId') ||
      message.includes('expectedReturnAt')
    ) {
      return Object.assign(
        new Error('Baza danych wymaga migracji dla zleceń teczek ze Spisów ZO. Uruchom migracje Prisma i zrestartuj aplikację.'),
        { statusCode: 400 }
      );
    }

    return err;
  }

  private async createOrderWithItems(data: any, tenantId: string, userId: string, resolvedItems: any[], orderNumber: string, slaDeadline: Date) {
    try {
      return await prisma.order.create({
        data: {
          tenantId,
          orderNumber,
          orderType: data.orderType,
          priority: data.priority || 'normal',
          status: 'draft',
          requestedBy: userId,
          slaDeadline,
          expectedReturnAt: parseExpectedReturnAt(data.expectedReturnAt),
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
    } catch (err) {
      throw this.getCreateOrderMigrationHint(err);
    }
  }

  private async generateOrderNumber() {
    const prefix = getMonthlyOrderNumberPrefix();
    const latestOrders = await prisma.order.findMany({
      where: { orderNumber: { startsWith: prefix } },
      orderBy: { orderNumber: 'desc' },
      take: 25,
      select: { orderNumber: true },
    });
    const maxSequence = latestOrders.reduce(
      (max, order) => Math.max(max, parseOrderNumberSequence(order.orderNumber, prefix)),
      0
    );

    return `${prefix}${(maxSequence + 1).toString().padStart(5, '0')}`;
  }

  private async createOrderWithUniqueNumber(data: any, tenantId: string, userId: string, resolvedItems: any[], slaDeadline: Date) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const orderNumber = await this.generateOrderNumber();
      try {
        return await this.createOrderWithItems(data, tenantId, userId, resolvedItems, orderNumber, slaDeadline);
      } catch (err) {
        if (isPrismaUniqueError(err, 'orderNumber')) continue;
        throw err;
      }
    }

    throw Object.assign(new Error('Nie udało się nadać unikalnego numeru zlecenia. Spróbuj ponownie za chwilę.'), { statusCode: 409 });
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
            folder: { select: { id: true, folderNumber: true, title: true, box: { select: { id: true, boxNumber: true } } } },
            document: {
              select: {
                id: true,
                title: true,
                docType: true,
                box: { select: { id: true, boxNumber: true, title: true } },
                folder: { select: { id: true, folderNumber: true, title: true, box: { select: { id: true, boxNumber: true } } } },
              },
            },
            transferListItem: {
              select: {
                id: true,
                folderSignature: true,
                folderTitle: true,
                categoryCode: true,
                box: { select: { id: true, boxNumber: true, title: true } },
                transferList: { select: { id: true, listNumber: true, title: true } },
              },
            },
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

  async delete(id: string, tenantId: string) {
    const order = await prisma.order.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });
    if (!order) throw Object.assign(new Error('Zlecenie nie znalezione'), { statusCode: 404 });
    if (!['completed', 'cancelled'].includes(order.status)) {
      throw Object.assign(new Error('Można usuwać tylko zlecenia zakończone albo anulowane'), { statusCode: 400 });
    }

    await prisma.$transaction([
      prisma.custodyEvent.updateMany({
        where: { orderId: id },
        data: { orderId: null },
      }),
      prisma.order.delete({ where: { id } }),
    ]);

    return { deleted: true };
  }

  async create(data: any, tenantId: string, userId: string, department?: string) {
    const slaDeadline = calculateSlaDeadline(data.priority || 'normal');
    const resolvedItems = await this.resolveOrderItems(data.items, tenantId, department);
    const order = await this.createOrderWithUniqueNumber(data, tenantId, userId, resolvedItems, slaDeadline);

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
        folder: { select: { id: true, folderNumber: true, title: true, box: { select: { id: true, boxNumber: true } } } },
        document: {
          select: {
            id: true,
            title: true,
            docType: true,
            box: { select: { id: true, boxNumber: true, title: true } },
            folder: { select: { id: true, folderNumber: true, title: true, box: { select: { id: true, boxNumber: true } } } },
          },
        },
        transferListItem: {
          select: {
            id: true,
            folderSignature: true,
            folderTitle: true,
            categoryCode: true,
            box: { select: { id: true, boxNumber: true, title: true } },
            transferList: { select: { id: true, listNumber: true, title: true } },
          },
        },
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
    const boxIds = order.items
      .map((item: any) => this.getOrderItemBoxId(item))
      .filter((boxId: string | null): boxId is string => Boolean(boxId));
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

  async returnLoanItem(orderId: string, itemId: string, tenantId: string, userId: string) {
    const order = await this.getById(orderId, tenantId);
    if (order.orderType !== 'checkout') {
      throw Object.assign(new Error('Zwrot można wykonać tylko dla wypożyczenia'), { statusCode: 400 });
    }
    if (!['delivered', 'completed'].includes(order.status)) {
      throw Object.assign(new Error('Zwrot można wykonać dopiero po wydaniu wypożyczenia'), { statusCode: 400 });
    }

    const item = order.items.find((entry: any) => entry.id === itemId);
    if (!item) throw Object.assign(new Error('Pozycja nie znaleziona'), { statusCode: 404 });
    if (item.itemStatus === OrderItemStatus.returned) {
      throw Object.assign(new Error('Pozycja została już zwrócona'), { statusCode: 400 });
    }
    if (item.itemStatus !== OrderItemStatus.delivered) {
      throw Object.assign(new Error('Zwracać można tylko wydane pozycje'), { statusCode: 400 });
    }

    const returnedAt = new Date();
    const boxId = this.getOrderItemBoxId(item);
    const operations: Prisma.PrismaPromise<any>[] = [
      prisma.orderItem.update({
        where: { id: itemId },
        data: { itemStatus: OrderItemStatus.returned },
      }),
    ];

    if (boxId) {
      operations.push(
        prisma.custodyEvent.create({
          data: {
            orderId,
            boxId,
            eventType: 'return_event',
            fromUserId: order.requestedBy,
            toUserId: userId,
            notes: `Zwrot pozycji z wypożyczenia ${order.orderNumber}`,
            eventAt: returnedAt,
          },
        })
      );
    }

    const remainingDeliveredItems = order.items.filter((entry: any) => (
      entry.id !== itemId && entry.itemStatus === OrderItemStatus.delivered
    ));
    if (remainingDeliveredItems.length === 0 && order.status !== 'completed') {
      operations.push(
        prisma.order.update({
          where: { id: orderId },
          data: { status: 'completed', completedAt: returnedAt },
        })
      );
    }

    await prisma.$transaction(operations);

    if (boxId) {
      const stillCheckedOut = await prisma.orderItem.count({
        where: {
          id: { not: itemId },
          itemStatus: OrderItemStatus.delivered,
          order: {
            tenantId,
            orderType: 'checkout',
            status: { in: ['delivered', 'completed'] },
          },
          OR: [
            { boxId },
            { folder: { boxId } },
            { document: { boxId } },
            { document: { folder: { boxId } } },
            { transferListItem: { boxId } },
            { hrFolder: { boxId } },
          ],
        },
      });

      if (stillCheckedOut === 0) {
        await prisma.box.updateMany({
          where: { id: boxId, tenantId },
          data: { status: 'active' },
        });
      }
    }

    return this.getById(orderId, tenantId);
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

  async getActiveLoans(tenantId: string, department?: string) {
    const checkoutItems = await prisma.orderItem.findMany({
      where: {
        itemStatus: OrderItemStatus.delivered,
        order: {
          tenantId,
          orderType: 'checkout',
          status: { in: ['delivered', 'completed'] },
        },
        ...(department ? {
          OR: [
            { box: { department: { equals: department, mode: 'insensitive' } } },
            { folder: { box: { department: { equals: department, mode: 'insensitive' } } } },
            { document: { box: { department: { equals: department, mode: 'insensitive' } } } },
            { document: { folder: { box: { department: { equals: department, mode: 'insensitive' } } } } },
            { transferListItem: { box: { department: { equals: department, mode: 'insensitive' } } } },
          ],
        } : {}),
      },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            requestedBy: true,
            requester: { select: { id: true, firstName: true, lastName: true, email: true } },
            assignee: { select: { id: true, firstName: true, lastName: true } },
            completedAt: true,
            expectedReturnAt: true,
            createdAt: true,
            status: true,
          },
        },
        box: { select: { id: true, boxNumber: true, title: true, status: true, location: { select: { fullPath: true } } } },
        folder: { select: { id: true, folderNumber: true, title: true, box: { select: { id: true, boxNumber: true, title: true, status: true, location: { select: { fullPath: true } } } } } },
        document: {
          select: {
            id: true,
            title: true,
            docType: true,
            box: { select: { id: true, boxNumber: true, title: true, status: true, location: { select: { fullPath: true } } } },
            folder: { select: { id: true, folderNumber: true, title: true, box: { select: { id: true, boxNumber: true, title: true, status: true, location: { select: { fullPath: true } } } } } },
          },
        },
        transferListItem: {
          select: {
            id: true,
            folderSignature: true,
            folderTitle: true,
            categoryCode: true,
            box: { select: { id: true, boxNumber: true, title: true, status: true, location: { select: { fullPath: true } } } },
            transferList: { select: { id: true, listNumber: true, title: true } },
          },
        },
        hrFolder: { select: { id: true, employeeFirstName: true, employeeLastName: true, box: { select: { id: true, boxNumber: true, title: true, status: true, location: { select: { fullPath: true } } } } } },
      },
      orderBy: { deliveredAt: 'desc' },
    });

    const returnItems = await prisma.orderItem.findMany({
      where: {
        itemStatus: OrderItemStatus.returned,
        order: {
          tenantId,
          orderType: 'return_order',
          status: { in: ['delivered', 'completed'] },
        },
      },
      select: {
        boxId: true,
        folderId: true,
        documentId: true,
        transferListItemId: true,
        hrFolderId: true,
        deliveredAt: true,
      },
    });

    const returnedAfter = new Map<string, Date>();
    for (const item of returnItems) {
      const key = item.boxId ? `box:${item.boxId}`
        : item.folderId ? `folder:${item.folderId}`
          : item.documentId ? `document:${item.documentId}`
            : item.transferListItemId ? `transferListItem:${item.transferListItemId}`
              : item.hrFolderId ? `hr:${item.hrFolderId}`
                : null;
      if (!key || !item.deliveredAt) continue;
      const current = returnedAfter.get(key);
      if (!current || item.deliveredAt > current) returnedAfter.set(key, item.deliveredAt);
    }

    return checkoutItems
      .filter((item) => {
        const parentBox = item.box || item.folder?.box || item.document?.box || item.document?.folder?.box || item.transferListItem?.box || item.hrFolder?.box || null;
        const key = item.boxId ? `box:${item.boxId}`
          : item.folderId ? `folder:${item.folderId}`
            : item.documentId ? `document:${item.documentId}`
              : item.transferListItemId ? `transferListItem:${item.transferListItemId}`
                : item.hrFolderId ? `hr:${item.hrFolderId}`
                  : null;
        if (!key || !item.deliveredAt) return false;
        const returnedAt = returnedAfter.get(key);
        const parentBoxReturnedAt = parentBox ? returnedAfter.get(`box:${parentBox.id}`) : undefined;
        const parentFolderReturnedAt = item.document?.folder?.id ? returnedAfter.get(`folder:${item.document.folder.id}`) : undefined;
        return (!returnedAt || returnedAt < item.deliveredAt)
          && (!parentBoxReturnedAt || parentBoxReturnedAt < item.deliveredAt)
          && (!parentFolderReturnedAt || parentFolderReturnedAt < item.deliveredAt);
      })
      .map((item) => {
        const parentBox = item.box || item.folder?.box || item.document?.box || item.document?.folder?.box || item.transferListItem?.box || item.hrFolder?.box || null;
        const itemType = item.box ? 'box'
          : item.folder ? 'folder'
            : item.document ? 'document'
              : item.transferListItem ? 'transfer_list_item'
                : item.hrFolder ? 'hr_folder'
                  : 'unknown';
        const title = item.box ? `${item.box.boxNumber} — ${item.box.title}`
          : item.folder ? `${item.folder.folderNumber} — ${item.folder.title}`
            : item.document ? item.document.title
              : item.transferListItem ? `${item.transferListItem.folderSignature} — ${item.transferListItem.folderTitle}`
                : item.hrFolder ? `${item.hrFolder.employeeLastName} ${item.hrFolder.employeeFirstName}`
                  : '—';

        return {
          id: item.id,
          itemType,
          title,
          deliveredAt: item.deliveredAt,
          status: item.itemStatus,
          order: item.order,
          box: parentBox,
          location: parentBox?.location?.fullPath || null,
        };
      });
  }
}

export const orderService = new OrderService();
