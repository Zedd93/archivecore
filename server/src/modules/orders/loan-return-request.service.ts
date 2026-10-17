import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../config/database';
import { scanItemDepartmentWhere } from './scan-access';

const LOAN_STATUSES = ['delivered', 'completed'] as const;
const REQUEST_COOLDOWN_MS = 24 * 60 * 60_000;

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

export class LoanReturnRequestService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async request(orderId: string, itemId: string, tenantId: string, actorId: string, department?: string, now = new Date()) {
    return this.db.$transaction(async (tx) => {
      const lockedOrder = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "orders"
        WHERE "id" = ${orderId}::uuid AND "tenantId" = ${tenantId}::uuid
        FOR UPDATE
      `);
      if (lockedOrder.length !== 1) throw httpError('Wypożyczenie nie zostało znalezione', 404);

      const item = await tx.orderItem.findFirst({
        where: {
          id: itemId, orderId, itemStatus: 'delivered',
          order: { tenantId, orderType: 'checkout', status: { in: [...LOAN_STATUSES] } },
          ...(department ? { AND: [scanItemDepartmentWhere(department)] } : {}),
        },
        select: {
          deliveredAt: true, boxId: true, folderId: true, documentId: true,
          transferListItemId: true, hrFolderId: true,
          box: { select: { boxNumber: true } },
          folder: { select: { boxId: true, title: true } },
          document: { select: { boxId: true, folderId: true, title: true, folder: { select: { boxId: true } } } },
          transferListItem: { select: { boxId: true, folderTitle: true, folder: { select: { boxId: true } } } },
          hrFolder: { select: { boxId: true } },
          order: {
            select: {
              orderNumber: true, requestedBy: true,
              requester: { select: { isActive: true, tenantId: true } },
            },
          },
        },
      });
      if (!item?.deliveredAt) throw httpError('Pozycja nie jest aktywnym wypożyczeniem lub nie masz do niej dostępu', 404);

      const borrower = item.order.requester;
      if (item.order.requestedBy === actorId) throw httpError('Nie możesz wysłać prośby o zwrot do siebie', 409);
      if (!borrower.isActive || (borrower.tenantId !== tenantId && borrower.tenantId !== null)) {
        throw httpError('Osoba zgłaszająca wypożyczenie nie ma już aktywnego konta w tym kliencie', 409);
      }
      const actor = await tx.user.findFirst({
        where: { id: actorId, isActive: true, OR: [{ tenantId }, { tenantId: null }] },
        select: { firstName: true, lastName: true },
      });
      if (!actor) throw httpError('Konto osoby zgłaszającej prośbę jest nieaktywne lub nie należy do tego klienta', 403);

      const parentBoxId = item.boxId || item.folder?.boxId || item.document?.boxId
        || item.document?.folder?.boxId || item.transferListItem?.boxId
        || item.transferListItem?.folder?.boxId || item.hrFolder?.boxId;
      const parentFolderId = item.folderId || item.document?.folderId;
      const returnTargets: Prisma.OrderItemWhereInput[] = [
        ...(parentBoxId ? [{ boxId: parentBoxId }] : []),
        ...(parentFolderId ? [{ folderId: parentFolderId }] : []),
        ...(item.documentId ? [{ documentId: item.documentId }] : []),
        ...(item.transferListItemId ? [{ transferListItemId: item.transferListItemId }] : []),
        ...(item.hrFolderId ? [{ hrFolderId: item.hrFolderId }] : []),
      ];
      const returned = await tx.orderItem.findFirst({
        where: {
          OR: returnTargets,
          deliveredAt: { gte: item.deliveredAt },
          order: { tenantId, orderType: 'return_order', status: { in: [...LOAN_STATUSES] } },
        },
        select: { id: true },
      });
      if (returned) throw httpError('Pozycja została już zwrócona. Odśwież listę wypożyczeń.', 409);

      const lastRequest = await tx.notification.findFirst({
        where: {
          userId: item.order.requestedBy, tenantId,
          type: 'loan_return_requested', entityType: 'order_item', entityId: itemId,
          createdAt: { gte: new Date(now.getTime() - REQUEST_COOLDOWN_MS) },
        },
        select: { id: true },
      });
      if (lastRequest) throw httpError('Prośba o zwrot tej pozycji została już wysłana w ostatnich 24 godzinach', 409);

      const itemLabel = item.box?.boxNumber || item.folder?.title || item.document?.title
        || item.transferListItem?.folderTitle || (item.hrFolder ? 'akta osobowe' : 'pozycję');
      await tx.notification.create({
        data: {
          userId: item.order.requestedBy, tenantId,
          type: 'loan_return_requested', entityType: 'order_item', entityId: itemId,
          title: `Prośba o zwrot z wypożyczenia ${item.order.orderNumber}`,
          message: `${actor.firstName} ${actor.lastName} prosi o zwrot: ${itemLabel} (wypożyczenie ${item.order.orderNumber}). Sprawdź, czy możesz zwrócić tę pozycję, albo skontaktuj się z obsługą archiwum.`,
          actionUrl: `/orders/${orderId}`,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId, userId: actorId, action: 'loan.return_request',
          entityType: 'order_item', entityId: itemId,
          newValues: { orderId, recipientId: item.order.requestedBy },
        },
      });
      return { requested: true };
    });
  }
}

export const loanReturnRequestService = new LoanReturnRequestService();
