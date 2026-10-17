import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';

export type DocumentationHoldTarget = 'folder' | 'document' | 'transfer_list';

function conflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

export class DocumentationLegalHoldService {
  async setHold(target: DocumentationHoldTarget, id: string, tenantId: string, actorId: string, hold: boolean, reason: string) {
    return prisma.$transaction(async (tx) => {
      let previous: { legalHold: boolean; legalHoldReason: string | null };
      let boxIds: string[];

      if (target === 'folder') {
        const folder = await tx.folder.findFirst({
          where: { id, tenantId },
          select: { legalHold: true, legalHoldReason: true, boxId: true, transferListItem: { select: { boxId: true } } },
        });
        if (!folder) throw Object.assign(new Error('Teczka nie znaleziona'), { statusCode: 404 });
        previous = folder;
        boxIds = [folder.boxId, folder.transferListItem?.boxId].filter((value): value is string => Boolean(value));
      } else if (target === 'document') {
        const document = await tx.document.findFirst({
          where: { id, tenantId },
          select: { legalHold: true, legalHoldReason: true, boxId: true, folder: { select: { boxId: true, transferListItem: { select: { boxId: true } } } } },
        });
        if (!document) throw Object.assign(new Error('Dokument nie znaleziony'), { statusCode: 404 });
        previous = document;
        boxIds = [document.boxId, document.folder?.boxId, document.folder?.transferListItem?.boxId]
          .filter((value): value is string => Boolean(value));
      } else {
        const list = await tx.transferList.findFirst({ where: { id, tenantId }, select: { legalHold: true, legalHoldReason: true } });
        if (!list) throw Object.assign(new Error('Spis nie znaleziony'), { statusCode: 404 });
        previous = list;
        const boxes = await tx.box.findMany({
          where: { tenantId, deletedAt: null, OR: [
            { transferListItems: { some: { transferListId: id } } },
            { folders: { some: { transferListItem: { is: { transferListId: id } } } } },
          ] },
          select: { id: true },
        });
        boxIds = boxes.map((box) => box.id);
      }

      if (previous.legalHold === hold) throw conflict('Stan blokady zmienił się. Odśwież stronę i spróbuj ponownie.');
      const uniqueBoxIds = [...new Set(boxIds)];
      if (hold && uniqueBoxIds.length) {
        const disposed = await tx.box.count({ where: { id: { in: uniqueBoxIds }, tenantId, status: 'disposed' } });
        if (disposed) throw conflict('Nie można objąć blokadą dokumentacji w wybrakowanym kartonie');
      }

      const data = { legalHold: hold, legalHoldReason: hold ? reason : null, legalHoldAt: hold ? new Date() : null };
      const where = { id, tenantId, legalHold: !hold };
      const updated = target === 'folder'
        ? await tx.folder.updateMany({ where, data })
        : target === 'document'
          ? await tx.document.updateMany({ where, data })
          : await tx.transferList.updateMany({ where, data });
      if (updated.count !== 1) throw conflict('Stan blokady zmienił się. Odśwież stronę i spróbuj ponownie.');

      if (hold && uniqueBoxIds.length) {
        await tx.box.updateMany({
          where: { id: { in: uniqueBoxIds }, tenantId, deletedAt: null, status: { in: ['pending_disposal', 'approved_disposal'] } },
          data: { status: 'active' },
        });
      }
      await tx.auditLog.create({ data: {
        tenantId, userId: actorId, entityType: target, entityId: id,
        action: hold ? 'legal_hold.placed' : 'legal_hold.released',
        oldValues: { legalHold: previous.legalHold, legalHoldReason: previous.legalHoldReason },
        newValues: { legalHold: hold, reason, affectedBoxIds: uniqueBoxIds },
      } });
      return data;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

export const documentationLegalHoldService = new DocumentationLegalHoldService();
