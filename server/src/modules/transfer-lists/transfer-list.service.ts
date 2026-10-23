import { prisma } from '../../config/database';
import { generateQrData, normalizeOptionalText } from '@archivecore/shared';
import { Prisma } from '@prisma/client';
import { jrwaSuggestionService } from '../retention/jrwa-suggestion.service';

const TRANSFER_LIST_ITEM_BOX_SELECT = {
  id: true,
  boxNumber: true,
  title: true,
  qrCode: true,
  location: { select: { id: true, code: true, name: true, fullPath: true } },
} satisfies Prisma.BoxSelect;

function reviewedScanRowError(error: unknown, index: number): Error {
  const original = error instanceof Error ? error : new Error(String(error));
  const details = original as Error & { statusCode?: number; code?: string; meta?: unknown };
  return Object.assign(new Error(`Pozycja ${index + 1}: ${original.message}`), {
    importRow: index + 1,
    statusCode: details.statusCode,
    code: details.code,
    meta: details.meta,
    cause: original,
  });
}

export class TransferListService {
  private ensureDraftStatus(list: { status: string }, message = 'Można edytować pozycje tylko w spisie o statusie roboczym') {
    if (list.status !== 'draft') {
      throw Object.assign(new Error(message), { statusCode: 400 });
    }
  }

  private getListOrderBy(filters: any): Prisma.TransferListOrderByWithRelationInput {
    const sortOrder: Prisma.SortOrder = String(filters.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    switch (filters.sortBy) {
      case 'listNumber':
        return { listNumber: sortOrder };
      case 'title':
        return { title: sortOrder };
      case 'transferDate':
        return { transferDate: sortOrder };
      case 'createdAt':
      default:
        return { createdAt: sortOrder };
    }
  }

  private parseOptionalDate(value: unknown): Date | null {
    if (!value) return null;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private ensureConsistentDateRange(data: { dateFrom?: unknown; dateTo?: unknown; dateRangeUnknown?: boolean }) {
    if (data.dateRangeUnknown && (data.dateFrom || data.dateTo)) {
      throw Object.assign(new Error('Nie można jednocześnie oznaczyć braku dat i podać dat skrajnych'), { statusCode: 400 });
    }
  }

  private getCanonicalFolderData(
    list: { id: string; tenantId: string },
    data: any,
    boxId: string | null,
    orderInBox: number
  ) {
    return {
      tenantId: list.tenantId,
      boxId,
      retentionPolicyId: data.retentionPolicyId ?? null,
      folderNumber: String(data.folderSignature || '').trim().substring(0, 100),
      title: String(data.folderTitle || '').trim().substring(0, 1000),
      dateFrom: this.parseOptionalDate(data.dateFrom),
      dateTo: this.parseOptionalDate(data.dateTo),
      description: normalizeOptionalText(data.notes),
      orderInBox,
      status: 'active' as const,
      customFields: {
        source: 'transfer_list',
        transferListId: list.id,
      },
    };
  }

  private getTransferListItemData(
    data: any,
    boxId: string | null,
    sourceBoxNumber: string | null,
    ordinalNumber: number
  ) {
    return {
      ordinalNumber,
      folderSignature: String(data.folderSignature || '').trim().substring(0, 100),
      folderTitle: String(data.folderTitle || '').trim().substring(0, 1000),
      dateFrom: this.parseOptionalDate(data.dateFrom),
      dateTo: this.parseOptionalDate(data.dateTo),
      dateRangeUnknown: data.dateRangeUnknown === true,
      categoryCode: String(data.categoryCode || 'B10').trim().substring(0, 20),
      folderCount: Math.max(1, Number.parseInt(String(data.folderCount), 10) || 1),
      storageLocation: normalizeOptionalText(data.storageLocation)?.substring(0, 500) ?? null,
      disposalOrTransferDate: this.parseOptionalDate(data.disposalOrTransferDate),
      notes: normalizeOptionalText(data.notes),
      boxId,
      sourceBoxNumber,
    };
  }

  private async createItemWithCanonicalFolder(
    tx: Prisma.TransactionClient,
    list: { id: string; tenantId: string },
    data: any,
    boxId: string | null,
    sourceBoxNumber: string | null,
    ordinalNumber: number
  ) {
    this.ensureConsistentDateRange(data);
    const folder = await tx.folder.create({
      data: this.getCanonicalFolderData(list, data, boxId, ordinalNumber),
    });

    return tx.transferListItem.create({
      data: {
        transferListId: list.id,
        folderId: folder.id,
        ...this.getTransferListItemData(data, boxId, sourceBoxNumber, ordinalNumber),
      },
      include: {
        box: { select: TRANSFER_LIST_ITEM_BOX_SELECT },
        folder: true,
      },
    });
  }

  // ─── List all transfer lists for a tenant ─────────────
  async list(tenantId: string, filters: any, skip: number, take: number) {
    const where: Prisma.TransferListWhereInput = { tenantId };

    if (filters.status) where.status = filters.status;
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { listNumber: { contains: filters.search, mode: 'insensitive' } },
        { transferringUnit: { contains: filters.search, mode: 'insensitive' } },
        { receivingUnit: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.transferList.findMany({
        where,
        skip,
        take,
        orderBy: this.getListOrderBy(filters),
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { items: true } },
        },
      }),
      prisma.transferList.count({ where }),
    ]);

    return { data, total };
  }

  // ─── Get single transfer list with items ──────────────
  async getById(id: string, tenantId: string) {
    const list = await prisma.transferList.findFirst({
      where: { id, tenantId },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        items: {
          orderBy: { ordinalNumber: 'asc' },
          include: {
            box: { select: TRANSFER_LIST_ITEM_BOX_SELECT },
          },
        },
      },
    });
    if (!list) throw Object.assign(new Error('Spis zdawczo-odbiorczy nie znaleziony'), { statusCode: 404 });
    return list;
  }

  // ─── Create new transfer list ──────────────────────────
  async create(data: any, tenantId: string, userId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
    // Generate list number
    const year = new Date().getFullYear();
    const lastList = await db.transferList.findFirst({
      where: { tenantId, listNumber: { startsWith: `SZO-${year}-` } },
      orderBy: { listNumber: 'desc' },
    });
    const seq = lastList ? parseInt(lastList.listNumber.split('-')[2]) + 1 : 1;
    const listNumber = `SZO-${year}-${seq.toString().padStart(4, '0')}`;

    return db.transferList.create({
      data: {
        tenantId,
        listNumber,
        title: normalizeOptionalText(data.title) || data.title,
        transferringUnit: normalizeOptionalText(data.transferringUnit),
        receivingUnit: normalizeOptionalText(data.receivingUnit),
        transferDate: data.transferDate ? new Date(data.transferDate) : undefined,
        notes: normalizeOptionalText(data.notes),
        createdById: userId,
        status: 'draft',
      },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { items: true } },
      },
    });
  }

  // ─── Update transfer list ──────────────────────────────
  async update(id: string, tenantId: string, data: any) {
    const list = await this.getById(id, tenantId);
    const nextListNumber = data.listNumber === undefined ? undefined : normalizeOptionalText(data.listNumber);

    if (data.listNumber !== undefined && !nextListNumber) {
      throw Object.assign(new Error('Numer spisu jest wymagany'), { statusCode: 400 });
    }

    if (nextListNumber && nextListNumber !== list.listNumber) {
      const existing = await prisma.transferList.findFirst({
        where: {
          tenantId,
          listNumber: nextListNumber,
          id: { not: id },
        },
        select: { id: true },
      });

      if (existing) {
        throw Object.assign(new Error('Spis o takim numerze już istnieje'), { statusCode: 409 });
      }
    }

    return prisma.transferList.update({
      where: { id },
      data: {
        listNumber: nextListNumber,
        title: data.title === undefined ? undefined : normalizeOptionalText(data.title),
        transferringUnit: data.transferringUnit === undefined ? undefined : normalizeOptionalText(data.transferringUnit),
        receivingUnit: data.receivingUnit === undefined ? undefined : normalizeOptionalText(data.receivingUnit),
        transferDate: data.transferDate === undefined ? undefined : data.transferDate ? new Date(data.transferDate) : null,
        notes: data.notes === undefined ? undefined : normalizeOptionalText(data.notes),
        status: data.status,
      },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { items: true } },
      },
    });
  }

  // ─── Delete transfer list ──────────────────────────────
  async delete(id: string, tenantId: string) {
    await prisma.$transaction(async (tx) => {
      const list = await tx.transferList.findFirst({
        where: { id, tenantId }, select: { status: true, legalHold: true, items: { take: 1, select: { id: true } } },
      });
      if (!list) throw Object.assign(new Error('Spis nie znaleziony'), { statusCode: 404 });
      if (list.legalHold) throw Object.assign(new Error('Nie można usunąć spisu objętego blokadą prawną'), { statusCode: 409 });
      if (list.status !== 'draft') throw Object.assign(new Error('Można usunąć tylko spis w statusie roboczym'), { statusCode: 400 });
      if (list.items.length) throw Object.assign(
        new Error('Nie można usunąć spisu zawierającego teczki. Aby chronić dane archiwalne, można usuwać wyłącznie puste spisy robocze.'),
        { statusCode: 409 },
      );
      await tx.transferList.delete({ where: { id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async generateSystemBoxNumber(tenantId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
    const year = new Date().getFullYear();
    const lastBox = await db.box.findFirst({
      where: { tenantId, boxNumber: { startsWith: `K-${year}-` } },
      orderBy: { boxNumber: 'desc' },
      select: { boxNumber: true },
    });
    const lastSequence = lastBox ? parseInt(lastBox.boxNumber.split('-').pop() || '0', 10) : 0;
    return `K-${year}-${(lastSequence + 1).toString().padStart(6, '0')}`;
  }

  private async createBoxForSourceNumber(
    list: { id: string; tenantId: string; listNumber: string },
    userId: string,
    sourceBoxNumber: string,
    db: Prisma.TransactionClient | typeof prisma = prisma
  ) {
    const tenant = await db.tenant.findUnique({ where: { id: list.tenantId } });
    if (!tenant) return null;

    const boxNumber = await this.generateSystemBoxNumber(list.tenantId, db);
    const qrCode = generateQrData(tenant.shortCode, boxNumber);

    const newBox = await db.box.create({
      data: {
        tenantId: list.tenantId,
        title: `Karton ${sourceBoxNumber} (${list.listNumber})`,
        boxNumber,
        qrCode,
        createdById: userId,
        status: 'active',
      },
    });

    return newBox.id;
  }

  // ─── Resolve local transfer-list box number to a system box ─────────────
  private async resolveTransferListBox(
    list: { id: string; tenantId: string; listNumber: string },
    userId: string,
    data: any,
    db: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<{ boxId: string | null; sourceBoxNumber: string | null }> {
    if (data.boxId) {
      const box = await db.box.findFirst({
        where: { id: data.boxId, tenantId: list.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!box) {
        throw Object.assign(new Error('Wybrany karton nie istnieje lub został usunięty'), { statusCode: 404 });
      }
      return {
        boxId: box.id,
        sourceBoxNumber: normalizeOptionalText(data.sourceBoxNumber ?? data.boxNumber) ?? null,
      };
    }

    const sourceBoxNumber = normalizeOptionalText(data.sourceBoxNumber ?? data.boxNumber) ?? null;
    if (!sourceBoxNumber) return { boxId: null, sourceBoxNumber: null };

    const existingInList = await db.transferListItem.findFirst({
      where: {
        transferListId: list.id,
        sourceBoxNumber: { equals: sourceBoxNumber, mode: 'insensitive' },
        boxId: { not: null },
      },
      select: { boxId: true },
    });
    if (existingInList?.boxId) {
      return { boxId: existingInList.boxId, sourceBoxNumber };
    }

    const boxId = await this.createBoxForSourceNumber(list, userId, sourceBoxNumber, db);
    return { boxId, sourceBoxNumber };
  }

  async createFromReviewedScan(title: string, tenantId: string, userId: string, items: any[]) {
    for (const [index, item] of items.entries()) {
      try {
        await jrwaSuggestionService.validateSelection(tenantId, item.retentionPolicyId, item.categoryCode);
      } catch (error) {
        throw reviewedScanRowError(error, index);
      }
    }

    return prisma.$transaction(async (tx) => {
      const list = await this.create({
        title,
        notes: 'Import z zeskanowanego spisu, po weryfikacji przez użytkownika',
      }, tenantId, userId, tx);
      for (const [index, item] of items.entries()) {
        try {
          const { boxId, sourceBoxNumber } = await this.resolveTransferListBox(list, userId, item, tx);
          await this.createItemWithCanonicalFolder(tx, list, item, boxId, sourceBoxNumber, index + 1);
        } catch (error) {
          throw reviewedScanRowError(error, index);
        }
      }
      return { listId: list.id, listNumber: list.listNumber, title: list.title, imported: items.length };
    }, { maxWait: 10_000, timeout: 120_000 });
  }

  // ─── Add item to list ──────────────────────────────────
  async addItem(listId: string, tenantId: string, userId: string, data: any) {
    const list = await this.getById(listId, tenantId);
    this.ensureDraftStatus(list, 'Można dodawać pozycje tylko w spisie o statusie roboczym');
    await jrwaSuggestionService.validateSelection(tenantId, data.retentionPolicyId, data.categoryCode);
    const { boxId, sourceBoxNumber } = await this.resolveTransferListBox(list, userId, data);

    // Get next ordinal number
    const lastItem = await prisma.transferListItem.findFirst({
      where: { transferListId: listId },
      orderBy: { ordinalNumber: 'desc' },
    });
    const ordinalNumber = (lastItem?.ordinalNumber ?? 0) + 1;

    return prisma.$transaction((tx) => this.createItemWithCanonicalFolder(
      tx,
      list,
      data,
      boxId,
      sourceBoxNumber,
      ordinalNumber
    ));
  }

  // ─── Update item ───────────────────────────────────────
  async updateItem(listId: string, itemId: string, tenantId: string, userId: string, data: any) {
    const list = await this.getById(listId, tenantId);
    this.ensureDraftStatus(list);
    const item = await prisma.transferListItem.findFirst({
      where: { id: itemId, transferListId: listId },
      select: { id: true, folderId: true, ordinalNumber: true, categoryCode: true, dateFrom: true, dateTo: true, dateRangeUnknown: true, folder: { select: { retentionPolicyId: true } } },
    });
    if (!item) throw Object.assign(new Error('Pozycja spisu nie znaleziona'), { statusCode: 404 });
    const nextDateRange = {
      dateFrom: data.dateFrom === undefined ? item.dateFrom : data.dateFrom,
      dateTo: data.dateTo === undefined ? item.dateTo : data.dateTo,
      dateRangeUnknown: data.dateRangeUnknown === undefined
        ? (data.dateFrom || data.dateTo ? false : item.dateRangeUnknown)
        : data.dateRangeUnknown,
    };
    this.ensureConsistentDateRange(nextDateRange);
    const selectedPolicyId = data.retentionPolicyId === undefined ? item.folder?.retentionPolicyId : data.retentionPolicyId;
    await jrwaSuggestionService.validateSelection(tenantId, selectedPolicyId, data.categoryCode ?? item.categoryCode, item.folder?.retentionPolicyId);
    const { boxId, sourceBoxNumber } = await this.resolveTransferListBox(list, userId, data);

    return prisma.$transaction(async (tx) => {
      let folderId = item.folderId;
      if (folderId) {
        const currentFolder = await tx.folder.findFirst({
          where: { id: folderId, tenantId },
          select: { retentionPolicyId: true, retentionPolicy: { select: { seriesLegalHold: true } } },
        });
        if (!currentFolder) throw Object.assign(new Error('Teczka nie znaleziona'), { statusCode: 404 });
        if (currentFolder.retentionPolicyId !== selectedPolicyId && currentFolder.retentionPolicy?.seriesLegalHold) {
          throw Object.assign(new Error('Nie można zmienić serii JRWA teczki objętej blokadą prawną'), { statusCode: 409 });
        }
        await tx.folder.update({
          where: { id: folderId },
          data: this.getCanonicalFolderData(list, { ...data, ...nextDateRange, retentionPolicyId: selectedPolicyId }, boxId, item.ordinalNumber),
        });
      } else {
        const folder = await tx.folder.create({
          data: this.getCanonicalFolderData(list, { ...data, ...nextDateRange, retentionPolicyId: selectedPolicyId }, boxId, item.ordinalNumber),
        });
        folderId = folder.id;
      }

      return tx.transferListItem.update({
        where: { id: itemId },
        data: {
          folderId,
          ...this.getTransferListItemData({ ...data, ...nextDateRange }, boxId, sourceBoxNumber, item.ordinalNumber),
        },
        include: {
          box: { select: TRANSFER_LIST_ITEM_BOX_SELECT },
          folder: true,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  // ─── Delete item ───────────────────────────────────────
  async deleteItem(listId: string, itemId: string, tenantId: string) {
    await prisma.$transaction(async (tx) => {
      const list = await tx.transferList.findFirst({ where: { id: listId, tenantId }, select: { status: true, legalHold: true } });
      if (!list) throw Object.assign(new Error('Spis nie znaleziony'), { statusCode: 404 });
      this.ensureDraftStatus(list, 'Można usuwać pozycje tylko w spisie o statusie roboczym');
      if (list.legalHold) throw Object.assign(new Error('Spis jest objęty blokadą prawną'), { statusCode: 409 });
      const item = await tx.transferListItem.findFirst({
        where: { id: itemId, transferListId: listId },
        select: { id: true, box: { select: { legalHold: true, retentionPolicy: { select: { seriesLegalHold: true } } } }, folder: { select: { legalHold: true, retentionPolicy: { select: { seriesLegalHold: true } }, box: { select: { legalHold: true, retentionPolicy: { select: { seriesLegalHold: true } } } }, documents: { where: { legalHold: true }, select: { id: true }, take: 1 } } } },
      });
      if (!item) throw Object.assign(new Error('Pozycja spisu nie znaleziona'), { statusCode: 404 });
      if (item.box?.legalHold || item.box?.retentionPolicy?.seriesLegalHold
        || item.folder.box?.legalHold || item.folder.box?.retentionPolicy?.seriesLegalHold
        || item.folder.legalHold || item.folder.retentionPolicy?.seriesLegalHold || item.folder.documents.length) {
        throw Object.assign(new Error('Karton, teczka lub jej dokument jest objęty blokadą prawną'), { statusCode: 409 });
      }
      await tx.transferListItem.delete({ where: { id: itemId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  // ─── Import items from parsed data (Excel/CSV) ────────
  async importItems(listId: string, tenantId: string, userId: string, items: any[]) {
    const list = await this.getById(listId, tenantId);
    this.ensureDraftStatus(list, 'Można importować pozycje tylko do spisu o statusie roboczym');

    // Get current max ordinal
    const lastItem = await prisma.transferListItem.findFirst({
      where: { transferListId: listId },
      orderBy: { ordinalNumber: 'desc' },
    });
    let ordinalNumber = (lastItem?.ordinalNumber ?? 0);

    const created = [];
    const errors: string[] = [];
    const errorDetails: { itemIndex: number; message: string }[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      ordinalNumber++;

      try {
        await jrwaSuggestionService.validateSelection(tenantId, item.retentionPolicyId, item.categoryCode);
        const { boxId, sourceBoxNumber } = await this.resolveTransferListBox(list, userId, item);

        const record = await prisma.$transaction((tx) => this.createItemWithCanonicalFolder(
          tx,
          list,
          item,
          boxId,
          sourceBoxNumber,
          ordinalNumber
        ));
        created.push(record);
      } catch (err: any) {
        errors.push(`Wiersz ${i + 1}: ${err.message}`);
        errorDetails.push({ itemIndex: i, message: err.message });
      }
    }

    return {
      imported: created.length,
      errors: errors.length > 0 ? errors : undefined,
      errorDetails,
      items: created,
    };
  }

  // ─── Bulk delete items ────────────────────────────────
  async bulkDeleteItems(listId: string, tenantId: string, itemIds: string[]) {
    return prisma.$transaction(async (tx) => {
      const list = await tx.transferList.findFirst({ where: { id: listId, tenantId }, select: { status: true, legalHold: true } });
      if (!list) throw Object.assign(new Error('Spis nie znaleziony'), { statusCode: 404 });
      this.ensureDraftStatus(list, 'Można usuwać pozycje tylko w spisie o statusie roboczym');
      if (list.legalHold) throw Object.assign(new Error('Spis jest objęty blokadą prawną'), { statusCode: 409 });
      const heldItems = await tx.transferListItem.count({ where: {
        id: { in: itemIds }, transferListId: listId,
        OR: [
          { box: { legalHold: true } },
          { box: { retentionPolicy: { is: { seriesLegalHold: true } } } },
          { folder: { box: { legalHold: true } } },
          { folder: { box: { retentionPolicy: { is: { seriesLegalHold: true } } } } },
          { folder: { legalHold: true } },
          { folder: { retentionPolicy: { is: { seriesLegalHold: true } } } },
          { folder: { documents: { some: { legalHold: true } } } },
        ],
      } });
      if (heldItems) throw Object.assign(new Error('Co najmniej jeden karton, teczka lub dokument jest objęty blokadą prawną'), { statusCode: 409 });
      const result = await tx.transferListItem.deleteMany({ where: { id: { in: itemIds }, transferListId: listId } });
      return { deleted: result.count };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  // ─── Bulk assign box to items ────────────────────────
  async bulkAssignBox(listId: string, tenantId: string, userId: string, itemIds: string[], boxNumber: string | null, boxIdInput?: string | null) {
    const list = await this.getById(listId, tenantId);
    this.ensureDraftStatus(list);

    let boxId: string | null = null;
    let sourceBoxNumber: string | null = null;
    let box: { id: string; boxNumber: string; title: string; location: { id: string; code: string; name: string; fullPath: string } | null } | null = null;
    if (boxIdInput || (boxNumber && boxNumber.trim())) {
      const resolved = await this.resolveTransferListBox(list, userId, {
        boxId: boxIdInput,
        boxNumber: boxNumber?.trim(),
      });
      boxId = resolved.boxId;
      sourceBoxNumber = resolved.sourceBoxNumber;
      if (boxId) {
        box = await prisma.box.findFirst({
          where: { id: boxId, deletedAt: null },
          select: {
            id: true,
            boxNumber: true,
            title: true,
            location: { select: { id: true, code: true, name: true, fullPath: true } },
          },
        });
      }
    }

    const linkedItems = await prisma.transferListItem.findMany({
      where: { id: { in: itemIds }, transferListId: listId },
      select: { folderId: true },
    });
    const folderIds = linkedItems
      .map((item) => item.folderId)
      .filter((id): id is string => Boolean(id));

    const [result] = await prisma.$transaction([
      prisma.transferListItem.updateMany({
        where: {
          id: { in: itemIds },
          transferListId: listId,
        },
        data: { boxId, sourceBoxNumber },
      }),
      prisma.folder.updateMany({
        where: { id: { in: folderIds }, tenantId },
        data: { boxId },
      }),
    ]);

    return { updated: result.count, box, sourceBoxNumber };
  }

  // ─── Bulk update storage location ────────────────────
  async bulkUpdateStorageLocation(listId: string, tenantId: string, itemIds: string[], storageLocation: string) {
    const list = await this.getById(listId, tenantId);
    this.ensureDraftStatus(list);

    const normalizedLocation = storageLocation.trim();
    const result = await prisma.transferListItem.updateMany({
      where: {
        id: { in: itemIds },
        transferListId: listId,
      },
      data: {
        storageLocation: normalizedLocation,
      },
    });

    return { updated: result.count, storageLocation: normalizedLocation };
  }

  // ─── Bulk update destruction / AP transfer date ───────
  async bulkUpdateDisposalDate(listId: string, tenantId: string, itemIds: string[], disposalOrTransferDate: string) {
    const list = await this.getById(listId, tenantId);
    this.ensureDraftStatus(list);

    const result = await prisma.transferListItem.updateMany({
      where: {
        id: { in: itemIds },
        transferListId: listId,
      },
      data: {
        disposalOrTransferDate: new Date(disposalOrTransferDate),
      },
    });

    return { updated: result.count, disposalOrTransferDate };
  }

  // ─── Change status ─────────────────────────────────────
  async changeStatus(id: string, tenantId: string, status: string) {
    const list = await this.getById(id, tenantId);

    const validTransitions: Record<string, string[]> = {
      draft: ['confirmed'],
      confirmed: ['archived', 'draft'],
      archived: [],
    };

    const allowed = validTransitions[list.status] || [];
    if (!allowed.includes(status)) {
      throw Object.assign(
        new Error(`Nie można zmienić statusu z "${list.status}" na "${status}"`),
        { statusCode: 400 }
      );
    }

    return prisma.transferList.update({
      where: { id },
      data: { status: status as any },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { items: true } },
      },
    });
  }

  // ─── Get items filtered ────────────────────────────────
  async getItems(listId: string, tenantId: string, filters: any, skip: number, take: number) {
    await this.getById(listId, tenantId);

    const where: Prisma.TransferListItemWhereInput = { transferListId: listId };

    if (filters.categoryCode) where.categoryCode = filters.categoryCode;
    if (filters.search) {
      where.OR = [
        { folderSignature: { contains: filters.search, mode: 'insensitive' } },
        { folderTitle: { contains: filters.search, mode: 'insensitive' } },
        { storageLocation: { contains: filters.search, mode: 'insensitive' } },
        { sourceBoxNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.boxId) where.boxId = filters.boxId;
    if (filters.hasBox === 'true') where.boxId = { not: null };
    if (filters.hasBox === 'false') where.boxId = null;
    if (filters.dates === 'unknown') where.dateRangeUnknown = true;

    const [data, total] = await Promise.all([
      prisma.transferListItem.findMany({
        where,
        skip,
        take,
        orderBy: { ordinalNumber: 'asc' },
        include: {
          box: { select: TRANSFER_LIST_ITEM_BOX_SELECT },
          folder: { select: { retentionPolicyId: true, retentionPolicy: { select: { id: true, jrwaCode: true, name: true, archivalCategory: true, retentionYears: true, isPermanent: true, jrwaVersion: { select: { label: true, validFrom: true, validTo: true } } } } } },
        },
      }),
      prisma.transferListItem.count({ where }),
    ]);

    return { data, total };
  }
}

export const transferListService = new TransferListService();
