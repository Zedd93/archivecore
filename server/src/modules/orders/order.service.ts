import { prisma } from '../../config/database';
import { Prisma, OrderStatus, OrderType, OrderPriority, OrderItemStatus } from '@prisma/client';
import { canMarkReadyAfterPicking, isValidTransition } from './order-state-machine';
import { SLA_LEVELS, BUSINESS_HOURS, Permissions, ORDER_STATUS_LABELS, generateFolderQrData } from '@archivecore/shared';
import { notificationService } from '../notifications/notification.service';
import { billingService } from '../pricing/billing.service';
import { departmentOrderVisibility } from './scan-access';
import { webhookService } from '../integrations/webhook.service';
import { assertDepartmentRequesterAction } from './order-requester-access';
import { ORDER_HISTORY_ACTIONS, toOrderHistoryEntry } from './order-history';
import { orderNotificationAudience } from './order-notifications';
import PDFDocument from 'pdfkit';

function validateHandoverSignature(data?: string) {
  if (!data) return;
  if (data.length > 170_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw Object.assign(new Error('Podpis musi być obrazem PNG do 120 KB'), { statusCode: 400 });
  }
  const encoded = data.slice('data:image/png;base64,'.length);
  const image = Buffer.from(encoded, 'base64');
  if (image.length === 0 || image.length > 120_000
    || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw Object.assign(new Error('Podpis musi być obrazem PNG do 120 KB'), { statusCode: 400 });
  }
  try {
    const document = new PDFDocument({ autoFirstPage: false }) as unknown as {
      openImage(data: Buffer): { width: number; height: number };
    };
    const decoded = document.openImage(image);
    if (decoded.width < 1 || decoded.height < 1 || decoded.width > 1200 || decoded.height > 400) throw new Error('Image dimensions');
  } catch {
    throw Object.assign(new Error('Podpis jest uszkodzony lub ma nieprawidłowe wymiary'), { statusCode: 400 });
  }
}

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
  private getCustodyTarget(item: any) {
    if (item.documentId) return { documentId: item.documentId };
    if (item.folderId) return { folderId: item.folderId };
    if (item.hrFolderId) return { hrFolderId: item.hrFolderId };
    if (item.boxId) return { boxId: item.boxId };
    return null;
  }

  private getOrderItemBoxId(item: any): string | null {
    return item.boxId
      || item.box?.id
      || item.folder?.box?.id
      || item.document?.box?.id
      || item.document?.folder?.box?.id
      || item.transferListItem?.box?.id
      || item.transferListItem?.folder?.box?.id
      || item.hrFolder?.box?.id
      || null;
  }

  private async assertDisposalNotHeld(order: any, tenantId: string) {
    const boxIds = [...new Set(order.items.map((item: any) => this.getOrderItemBoxId(item)).filter(Boolean))] as string[];
    const hrFolderIds = order.items.map((item: any) => item.hrFolderId).filter(Boolean) as string[];
    const [heldBoxes, heldHrFolders] = await Promise.all([
      boxIds.length ? prisma.box.count({
        where: { id: { in: boxIds }, tenantId, OR: [{ legalHold: true }, { hrFolders: { some: { litigationHold: true } } }] },
      }) : 0,
      hrFolderIds.length ? prisma.hRFolder.count({ where: { id: { in: hrFolderIds }, tenantId, litigationHold: true } }) : 0,
    ]);
    if (heldBoxes || heldHrFolders) {
      throw Object.assign(new Error('Nie można realizować brakowania dokumentacji objętej blokadą'), { statusCode: 409 });
    }
  }

  private async notifyOrderStatus(order: any, newStatus: OrderStatus, actorId: string, db: Prisma.TransactionClient) {
    const audience = orderNotificationAudience(newStatus);

    await notificationService.notifyTenantUsers({
      tenantId: order.tenantId,
      ...audience,
      includeUserIds: [order.requestedBy, order.assignedTo, order.approvedBy].filter(Boolean),
      excludeUserIds: [actorId],
      type: 'order_status',
      title: `Zlecenie ${order.orderNumber}: ${ORDER_STATUS_LABELS[newStatus] || newStatus}`,
      message: `Status zlecenia ${order.orderNumber} zmieniono na "${ORDER_STATUS_LABELS[newStatus] || newStatus}".`,
      entityType: 'order',
      entityId: order.id,
      actionUrl: `/orders/${order.id}`,
    }, db);
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
          deletedAt: null,
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
        select: { id: true, folderId: true },
      });

      if (!transferListItem) {
        throw Object.assign(new Error('Pozycja spisu nie istnieje albo nie masz do niej dostępu'), { statusCode: 404 });
      }

      return {
        transferListItemId: transferListItem.id,
        folderId: transferListItem.folderId,
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

  async list(tenantId: string, filters: any, skip: number, take: number, department?: string) {
    const where: Prisma.OrderWhereInput = { tenantId };
    if (department) where.AND = [departmentOrderVisibility(department)];

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

  async listWarehouseTasks(tenantId: string, department?: string) {
    const where: Prisma.OrderWhereInput = {
      tenantId,
      status: { in: [OrderStatus.approved, OrderStatus.in_progress, OrderStatus.ready] },
      ...(department ? { AND: [departmentOrderVisibility(department)] } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.order.findMany({
        where,
        take: 12,
        orderBy: [
          { slaDeadline: { sort: 'asc', nulls: 'last' } },
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
        select: {
          id: true,
          orderNumber: true,
          orderType: true,
          status: true,
          priority: true,
          slaDeadline: true,
          createdAt: true,
          assignee: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.order.count({ where }),
    ]);
    return { data, total };
  }

  async getById(id: string, tenantId: string, department?: string) {
    const order = await prisma.order.findFirst({
      where: { id, tenantId, ...(department ? { AND: [departmentOrderVisibility(department)] } : {}) },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true, email: true } },
        approver: { select: { id: true, firstName: true, lastName: true } },
        assignee: { select: { id: true, firstName: true, lastName: true } },
        items: {
          include: {
            box: { select: { id: true, boxNumber: true, title: true, status: true, qrCode: true, locationId: true, location: { select: { fullPath: true } } } },
            folder: { select: { id: true, folderNumber: true, title: true, box: { select: { id: true, boxNumber: true, location: { select: { fullPath: true } } } } } },
            document: {
              select: {
                id: true,
                title: true,
                docType: true,
                box: { select: { id: true, boxNumber: true, title: true, location: { select: { fullPath: true } } } },
                folder: { select: { id: true, folderNumber: true, title: true, box: { select: { id: true, boxNumber: true, location: { select: { fullPath: true } } } } } },
              },
            },
            transferListItem: {
              select: {
                id: true,
                folderSignature: true,
                folderTitle: true,
                categoryCode: true,
                box: { select: { id: true, boxNumber: true, title: true, location: { select: { fullPath: true } } } },
                folder: { select: { box: { select: { id: true, boxNumber: true, location: { select: { fullPath: true } } } } } },
                transferList: { select: { id: true, listNumber: true, title: true } },
              },
            },
            hrFolder: { select: { id: true, employeeFirstName: true, employeeLastName: true, box: { select: { id: true, boxNumber: true, location: { select: { fullPath: true } } } } } },
            picker: { select: { id: true, firstName: true, lastName: true } },
            scanFile: { select: { id: true, fileName: true, pageCount: true, fileSize: true, uploadedAt: true } },
          },
        },
        custodyEvents: {
          orderBy: { eventAt: 'desc' },
          take: 20,
          select: {
            id: true, orderId: true, eventType: true, eventAt: true, notes: true,
            boxId: true, folderId: true, documentId: true, hrFolderId: true,
            recipientName: true,
            performedBy: { select: { firstName: true, lastName: true } },
            box: { select: { id: true, boxNumber: true } },
            folder: { select: { id: true, folderNumber: true, title: true } },
            document: { select: { id: true, title: true } },
            hrFolder: { select: { id: true, employeeFirstName: true, employeeLastName: true } },
            fromUser: { select: { firstName: true, lastName: true } },
            toUser: { select: { firstName: true, lastName: true } },
          },
        },
        handoverProof: {
          include: {
            recordedBy: { select: { firstName: true, lastName: true } },
            boxChecks: { include: { box: { select: { boxNumber: true } } } },
          },
        },
      },
    });
    if (!order) throw Object.assign(new Error('Zlecenie nie znalezione'), { statusCode: 404 });
    return order;
  }

  async getHistory(id: string, tenantId: string, skip: number, take: number, department?: string) {
    const visible = await prisma.order.findFirst({
      where: { id, tenantId, ...(department ? { AND: [departmentOrderVisibility(department)] } : {}) },
      select: { id: true },
    });
    if (!visible) throw Object.assign(new Error('Zlecenie nie znalezione'), { statusCode: 404 });

    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      entityType: 'order',
      entityId: id,
      action: { in: ORDER_HISTORY_ACTIONS },
    };
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          action: true,
          createdAt: true,
          oldValues: true,
          newValues: true,
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return { data: logs.map(toOrderHistoryEntry), total };
  }

  async delete(id: string, tenantId: string) {
    const order = await prisma.order.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, orderNumber: true },
    });
    if (!order) throw Object.assign(new Error('Zlecenie nie znalezione'), { statusCode: 404 });
    if (!['completed', 'cancelled'].includes(order.status)) {
      throw Object.assign(new Error('Można usuwać tylko zlecenia zakończone albo anulowane'), { statusCode: 400 });
    }
    if (await prisma.orderScanFile.count({ where: { tenantId, orderItem: { orderId: id } } })) {
      throw Object.assign(new Error('Zlecenie zawiera skany i musi pozostać w historii'), { statusCode: 409 });
    }
    if (await prisma.orderHandoverPhoto.count({ where: { tenantId, orderId: id } })) {
      throw Object.assign(new Error('Zlecenie zawiera zdjęcia przekazania i musi pozostać w historii'), { statusCode: 409 });
    }

    await prisma.$transaction([
      prisma.custodyEvent.updateMany({
        where: { orderId: id },
        data: { orderId: null, orderNumberSnapshot: order.orderNumber },
      }),
      prisma.order.delete({ where: { id } }),
    ]);

    return { deleted: true };
  }

  async create(data: any, tenantId: string, userId: string, department?: string) {
    if (data.orderType === 'scan' && data.items.some((item: any) => item.boxId || item.boxNumber || item.hrFolderId)) {
      throw Object.assign(new Error('Zlecenie skanu może zawierać tylko teczki, pozycje spisu lub dokumenty'), { statusCode: 400 });
    }
    const slaDeadline = calculateSlaDeadline(data.priority || 'normal');
    const resolvedItems = await this.resolveOrderItems(data.items, tenantId, department);
    const order = await this.createOrderWithUniqueNumber(data, tenantId, userId, resolvedItems, slaDeadline);

    return order;
  }

  async addItem(orderId: string, tenantId: string, item: any, userId: string, department?: string) {
    const order = await this.getById(orderId, tenantId, department);
    if (department) assertDepartmentRequesterAction(order, userId, 'addItem');
    if (['ready', 'delivered', 'completed', 'cancelled'].includes(order.status)) {
      throw Object.assign(new Error('Nie można dodawać pozycji do gotowego, wydanego, zakończonego albo anulowanego zlecenia'), { statusCode: 400 });
    }
    if (order.orderType === 'scan' && (item.boxId || item.boxNumber || item.hrFolderId)) {
      throw Object.assign(new Error('Do zlecenia skanu można dodać tylko teczkę, pozycję spisu lub dokument'), { statusCode: 400 });
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

  async updateStatus(id: string, tenantId: string, newStatus: OrderStatus, userId: string, notes?: string, department?: string) {
    const order = await this.getById(id, tenantId, department);
    if (department && (newStatus === OrderStatus.submitted || newStatus === OrderStatus.cancelled)) {
      assertDepartmentRequesterAction(order, userId, newStatus === OrderStatus.submitted ? 'submit' : 'cancel');
    }

    if (order.orderType === 'scan' && order.status === 'delivered' && newStatus === 'in_progress') {
      throw Object.assign(new Error('Udostępnionego zlecenia skanu nie można ponownie otworzyć'), { statusCode: 409 });
    }

    if (order.orderType === 'disposal' && newStatus !== 'cancelled' && newStatus !== 'rejected') {
      await this.assertDisposalNotHeld(order, tenantId);
    }

    if (!isValidTransition(order.status as OrderStatus, newStatus)) {
      throw Object.assign(
        new Error(`Niedozwolona zmiana statusu z "${order.status}" na "${newStatus}"`),
        { statusCode: 400 }
      );
    }

    const updateData = this.getStatusUpdateData(order, newStatus, userId, notes);

    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.order.update({
        where: { id },
        data: updateData,
        include: {
          requester: { select: { id: true, firstName: true, lastName: true } },
          approver: { select: { id: true, firstName: true, lastName: true } },
          assignee: { select: { id: true, firstName: true, lastName: true } },
          items: true,
        },
      });
      if (newStatus === OrderStatus.completed) {
        await tx.orderItem.updateMany({
          where: {
            orderId: id,
            itemStatus: { in: [OrderItemStatus.pending, OrderItemStatus.picked] },
          },
          data: {
            itemStatus: OrderItemStatus.delivered,
            deliveredAt: changed.completedAt ?? new Date(),
          },
        });
      }
      await webhookService.enqueueOrderStatus(tx, changed, order.status, newStatus);
      await this.notifyOrderStatus(changed, newStatus, userId, tx);
      return changed;
    });

    return updated;
  }

  async submit(id: string, tenantId: string, userId: string, department?: string) {
    return this.updateStatus(id, tenantId, 'submitted', userId, undefined, department);
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
    const order = await this.getById(id, tenantId);
    if (order.orderType === 'scan' && (order.items.length === 0 || order.items.some((item) => !item.scanFile))) {
      throw Object.assign(new Error('Dodaj skan PDF do każdej pozycji przed oznaczeniem zlecenia jako gotowe'), { statusCode: 409 });
    }
    if (order.status === 'in_progress'
      && !canMarkReadyAfterPicking(order.orderType, order.items.map((item) => item.itemStatus))) {
      throw Object.assign(new Error('Najpierw potwierdź pobranie wszystkich pozycji zlecenia'), { statusCode: 400 });
    }
    return this.updateStatus(id, tenantId, 'ready', userId);
  }

  async deliver(id: string, tenantId: string, userId: string, proof?: {
    recipientName: string;
    signatureData?: string;
    latitude?: number;
    longitude?: number;
    accuracyMeters?: number;
    boxChecks?: Array<{ boxId: string; condition: 'intact' | 'damaged' | 'unverified'; sealNumber?: string; conditionNote?: string }>;
  }) {
    const order = await this.getById(id, tenantId);
    if (proof && !['checkout', 'return_order'].includes(order.orderType)) {
      throw Object.assign(new Error('Potwierdzenie odbioru jest dostępne tylko dla wydań i zwrotów'), { statusCode: 400 });
    }
    validateHandoverSignature(proof?.signatureData);
    if (order.orderType === 'disposal') await this.assertDisposalNotHeld(order, tenantId);
    if (!isValidTransition(order.status as OrderStatus, 'delivered')) {
      throw Object.assign(
        new Error(`Niedozwolona zmiana statusu z "${order.status}" na "delivered"`),
        { statusCode: 400 }
      );
    }

    const deliveredAt = new Date();
    const nextItemStatus = order.orderType === 'return_order' ? OrderItemStatus.returned : OrderItemStatus.delivered;
    const custodyTargets = (order.orderType === 'scan' ? [] : order.items)
      .map((item: any) => this.getCustodyTarget(item))
      .filter((target: any) => target !== null);
    const wholeBoxIds = order.items
      .map((item: any) => item.boxId)
      .filter((boxId: string | null): boxId is string => Boolean(boxId));
    if (proof?.boxChecks) {
      const expected = new Set(wholeBoxIds);
      const supplied = new Set(proof.boxChecks.map((check) => check.boxId));
      if (supplied.size !== expected.size || proof.boxChecks.length !== expected.size
        || [...supplied].some((boxId) => !expected.has(boxId))) {
        throw Object.assign(new Error('Potwierdź stan każdego kartonu wydawanego w tym zleceniu'), { statusCode: 400 });
      }
    }
    const boxStatus = order.orderType === 'checkout'
      ? 'checked_out'
      : order.orderType === 'return_order'
        ? 'active'
        : undefined;
    const billingEvents = await billingService.buildOrderDeliveryEvents(order, deliveredAt);

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: this.getStatusUpdateData(order, 'delivered', userId),
      });
      await tx.orderItem.updateMany({
        where: {
          orderId: id,
          itemStatus: { in: [OrderItemStatus.pending, OrderItemStatus.picked] },
        },
        data: {
          itemStatus: nextItemStatus,
          deliveredAt,
        },
      });

      if (proof) {
        await tx.orderHandoverProof.create({
          data: {
            orderId: id,
            recordedById: userId,
            recipientName: proof.recipientName,
            signatureData: proof.signatureData,
            latitude: proof.latitude,
            longitude: proof.longitude,
            accuracyMeters: proof.accuracyMeters,
            recordedAt: deliveredAt,
          },
        });
        if (proof.boxChecks?.length) {
          await tx.orderHandoverBox.createMany({
            data: proof.boxChecks.map((check) => ({
              orderId: id,
              boxId: check.boxId,
              condition: check.condition,
              sealNumber: check.sealNumber || null,
              conditionNote: check.conditionNote || null,
            })),
          });
        }
      }

      if (custodyTargets.length > 0) {
        await tx.custodyEvent.createMany({
          data: custodyTargets.map((target: any) => ({
            orderId: id,
            orderNumberSnapshot: order.orderNumber,
            ...target,
            eventType: order.orderType === 'return_order' ? 'return_event' : 'handover',
            fromUserId: userId,
            performedById: userId,
            recipientName: proof?.recipientName || null,
            eventAt: deliveredAt,
          })),
        });
      }

      if (wholeBoxIds.length > 0 && boxStatus) {
        await tx.box.updateMany({
          where: { id: { in: wholeBoxIds }, tenantId, deletedAt: null },
          data: { status: boxStatus },
        });
      }

      if (billingEvents.length > 0) {
        await tx.billingEvent.createMany({
          data: billingEvents,
          skipDuplicates: true,
        });
      }
      await webhookService.enqueueOrderStatus(tx, order, order.status, 'delivered');
      await this.notifyOrderStatus(order, 'delivered', userId, tx);
    });

    return this.getById(id, tenantId);
  }

  async complete(id: string, tenantId: string, userId: string) {
    await this.updateStatus(id, tenantId, 'completed', userId);
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
    const custodyTarget = this.getCustodyTarget(item);
    await prisma.$transaction(async (tx) => {
      const lockedOrder = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "orders"
        WHERE "id" = ${orderId}::uuid AND "tenantId" = ${tenantId}::uuid
        FOR UPDATE
      `);
      if (lockedOrder.length !== 1) {
        throw Object.assign(new Error('Zlecenie nie znalezione'), { statusCode: 404 });
      }
      if (boxId) {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "boxes"
          WHERE "id" = ${boxId}::uuid AND "tenantId" = ${tenantId}::uuid
          FOR UPDATE
        `);
      }

      const updated = await tx.orderItem.updateMany({
        where: {
          id: itemId,
          orderId,
          itemStatus: OrderItemStatus.delivered,
          order: { tenantId, orderType: 'checkout', status: { in: ['delivered', 'completed'] } },
        },
        data: { itemStatus: OrderItemStatus.returned },
      });
      if (updated.count !== 1) {
        throw Object.assign(new Error('Pozycja została już zwrócona. Odśwież listę wypożyczeń.'), { statusCode: 409 });
      }

      if (custodyTarget) {
        await tx.custodyEvent.create({
          data: {
            orderId,
            orderNumberSnapshot: order.orderNumber,
            ...custodyTarget,
            eventType: 'return_event',
            performedById: userId,
            toUserId: userId,
            notes: `Zwrot pozycji z wypożyczenia ${order.orderNumber}`,
            eventAt: returnedAt,
          },
        });
      }

      const remainingDeliveredItems = await tx.orderItem.count({
        where: { orderId, itemStatus: OrderItemStatus.delivered },
      });
      let statusChanged = false;
      if (remainingDeliveredItems === 0) {
        const updated = await tx.order.updateMany({
          where: { id: orderId, tenantId, status: 'delivered' },
          data: { status: 'completed', completedAt: returnedAt },
        });
        statusChanged = updated.count === 1;
        if (statusChanged) await webhookService.enqueueOrderStatus(tx, order, order.status, 'completed');
      }
      if (item.boxId && boxId) {
        const stillCheckedOut = await tx.orderItem.count({
          where: {
            id: { not: itemId },
            boxId,
            itemStatus: OrderItemStatus.delivered,
            order: {
              tenantId,
              orderType: 'checkout',
              status: { in: ['delivered', 'completed'] },
            },
          },
        });
        if (stillCheckedOut === 0) {
          await tx.box.updateMany({
            where: { id: boxId, tenantId, deletedAt: null },
            data: { status: 'active' },
          });
        }
      }
    });

    return this.getById(orderId, tenantId);
  }

  async cancel(id: string, tenantId: string, userId: string, notes?: string, department?: string) {
    return this.updateStatus(id, tenantId, 'cancelled', userId, notes, department);
  }

  async updateItemStatus(
    orderId: string, itemId: string, tenantId: string,
    status: 'pending' | 'picked', userId: string
  ) {
    const order = await this.getById(orderId, tenantId);
    const item = order.items.find((i: any) => i.id === itemId);
    if (!item) throw Object.assign(new Error('Pozycja nie znaleziona'), { statusCode: 404 });
    if (order.orderType !== 'checkout' || order.status !== 'in_progress') {
      throw Object.assign(new Error('Pobieranie pozycji jest dostępne tylko podczas realizacji zlecenia wydania'), { statusCode: 400 });
    }

    const previousStatus = status === OrderItemStatus.picked ? OrderItemStatus.pending : OrderItemStatus.picked;
    const result = await prisma.orderItem.updateMany({
      where: {
        id: itemId,
        orderId,
        itemStatus: previousStatus,
        order: { tenantId, status: OrderStatus.in_progress },
      },
      data: {
        itemStatus: status,
        pickedById: status === OrderItemStatus.picked ? userId : null,
        pickedAt: status === OrderItemStatus.picked ? new Date() : null,
      },
    });
    if (result.count !== 1) {
      throw Object.assign(new Error('Status pozycji zmienił się w międzyczasie. Odśwież zlecenie.'), { statusCode: 409 });
    }

    return prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
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
        box: { select: { id: true, boxNumber: true, title: true, status: true, qrCode: true, location: { select: { fullPath: true } } } },
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
          qrCode: item.boxId ? item.box?.qrCode || null : item.folderId ? generateFolderQrData(item.folderId) : null,
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
