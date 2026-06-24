import { prisma } from '../../config/database';
import { generateQrData, normalizeOptionalText } from '@archivecore/shared';
import { Prisma } from '@prisma/client';

const TRANSFER_LIST_ITEM_BOX_SELECT = {
  id: true,
  boxNumber: true,
  title: true,
  qrCode: true,
  location: { select: { id: true, code: true, name: true, fullPath: true } },
} satisfies Prisma.BoxSelect;

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
  async create(data: any, tenantId: string, userId: string) {
    // Generate list number
    const year = new Date().getFullYear();
    const lastList = await prisma.transferList.findFirst({
      where: { tenantId, listNumber: { startsWith: `SZO-${year}-` } },
      orderBy: { listNumber: 'desc' },
    });
    const seq = lastList ? parseInt(lastList.listNumber.split('-')[2]) + 1 : 1;
    const listNumber = `SZO-${year}-${seq.toString().padStart(4, '0')}`;

    return prisma.transferList.create({
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
    const list = await this.getById(id, tenantId);
    if (list.status !== 'draft') {
      throw Object.assign(new Error('Można usunąć tylko spis w statusie roboczym'), { statusCode: 400 });
    }
    await prisma.transferList.delete({ where: { id } });
  }

  private async generateSystemBoxNumber(tenantId: string) {
    const year = new Date().getFullYear();
    const lastBox = await prisma.box.findFirst({
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
    sourceBoxNumber: string
  ) {
    const tenant = await prisma.tenant.findUnique({ where: { id: list.tenantId } });
    if (!tenant) return null;

    const boxNumber = await this.generateSystemBoxNumber(list.tenantId);
    const qrCode = generateQrData(tenant.shortCode, boxNumber);

    const newBox = await prisma.box.create({
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
    data: any
  ): Promise<{ boxId: string | null; sourceBoxNumber: string | null }> {
    if (data.boxId) {
      return {
        boxId: data.boxId,
        sourceBoxNumber: normalizeOptionalText(data.sourceBoxNumber ?? data.boxNumber) ?? null,
      };
    }

    const sourceBoxNumber = normalizeOptionalText(data.sourceBoxNumber ?? data.boxNumber) ?? null;
    if (!sourceBoxNumber) return { boxId: null, sourceBoxNumber: null };

    const existingInList = await prisma.transferListItem.findFirst({
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

    const boxId = await this.createBoxForSourceNumber(list, userId, sourceBoxNumber);
    return { boxId, sourceBoxNumber };
  }

  // ─── Add item to list ──────────────────────────────────
  async addItem(listId: string, tenantId: string, userId: string, data: any) {
    const list = await this.getById(listId, tenantId);
    this.ensureDraftStatus(list, 'Można dodawać pozycje tylko w spisie o statusie roboczym');
    const { boxId, sourceBoxNumber } = await this.resolveTransferListBox(list, userId, data);

    // Get next ordinal number
    const lastItem = await prisma.transferListItem.findFirst({
      where: { transferListId: listId },
      orderBy: { ordinalNumber: 'desc' },
    });
    const ordinalNumber = (lastItem?.ordinalNumber ?? 0) + 1;

    return prisma.transferListItem.create({
      data: {
        transferListId: listId,
        ordinalNumber,
        folderSignature: data.folderSignature,
        folderTitle: data.folderTitle,
        dateFrom: data.dateFrom ? new Date(data.dateFrom) : null,
        dateTo: data.dateTo ? new Date(data.dateTo) : null,
        categoryCode: data.categoryCode,
        folderCount: data.folderCount ?? 1,
        storageLocation: data.storageLocation,
        disposalOrTransferDate: data.disposalOrTransferDate ? new Date(data.disposalOrTransferDate) : null,
        notes: data.notes,
        boxId,
        sourceBoxNumber,
      },
      include: {
        box: { select: TRANSFER_LIST_ITEM_BOX_SELECT },
      },
    });
  }

  // ─── Update item ───────────────────────────────────────
  async updateItem(listId: string, itemId: string, tenantId: string, userId: string, data: any) {
    const list = await this.getById(listId, tenantId);
    this.ensureDraftStatus(list);
    const { boxId, sourceBoxNumber } = await this.resolveTransferListBox(list, userId, data);

    const item = await prisma.transferListItem.findFirst({
      where: { id: itemId, transferListId: listId },
    });
    if (!item) throw Object.assign(new Error('Pozycja spisu nie znaleziona'), { statusCode: 404 });

    return prisma.transferListItem.update({
      where: { id: itemId },
      data: {
        folderSignature: data.folderSignature,
        folderTitle: data.folderTitle,
        dateFrom: data.dateFrom ? new Date(data.dateFrom) : null,
        dateTo: data.dateTo ? new Date(data.dateTo) : null,
        categoryCode: data.categoryCode,
        folderCount: data.folderCount,
        storageLocation: data.storageLocation,
        disposalOrTransferDate: data.disposalOrTransferDate ? new Date(data.disposalOrTransferDate) : null,
        notes: data.notes,
        boxId,
        sourceBoxNumber,
      },
      include: {
        box: { select: TRANSFER_LIST_ITEM_BOX_SELECT },
      },
    });
  }

  // ─── Delete item ───────────────────────────────────────
  async deleteItem(listId: string, itemId: string, tenantId: string) {
    const list = await this.getById(listId, tenantId);
    this.ensureDraftStatus(list, 'Można usuwać pozycje tylko w spisie o statusie roboczym');
    const item = await prisma.transferListItem.findFirst({
      where: { id: itemId, transferListId: listId },
    });
    if (!item) throw Object.assign(new Error('Pozycja spisu nie znaleziona'), { statusCode: 404 });
    await prisma.transferListItem.delete({ where: { id: itemId } });
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

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      ordinalNumber++;

      try {
        const { boxId, sourceBoxNumber } = await this.resolveTransferListBox(list, userId, item);

        // Safely parse dates
        const safeDate = (val: any): Date | null => {
          if (!val) return null;
          const d = new Date(val);
          return isNaN(d.getTime()) ? null : d;
        };

        const record = await prisma.transferListItem.create({
          data: {
            transferListId: listId,
            ordinalNumber,
            folderSignature: String(item.folderSignature || '').trim().substring(0, 100),
            folderTitle: String(item.folderTitle || '').trim().substring(0, 1000),
            dateFrom: safeDate(item.dateFrom),
            dateTo: safeDate(item.dateTo),
            categoryCode: String(item.categoryCode || 'B10').trim().substring(0, 20),
            folderCount: Math.max(1, parseInt(String(item.folderCount)) || 1),
            storageLocation: item.storageLocation ? String(item.storageLocation).trim().substring(0, 500) : null,
            disposalOrTransferDate: safeDate(item.disposalOrTransferDate),
            notes: item.notes ? String(item.notes).trim() : null,
            boxId,
            sourceBoxNumber,
          },
          include: {
            box: { select: TRANSFER_LIST_ITEM_BOX_SELECT },
          },
        });
        created.push(record);
      } catch (err: any) {
        errors.push(`Wiersz ${i + 1}: ${err.message}`);
      }
    }

    return {
      imported: created.length,
      errors: errors.length > 0 ? errors : undefined,
      items: created,
    };
  }

  // ─── Bulk delete items ────────────────────────────────
  async bulkDeleteItems(listId: string, tenantId: string, itemIds: string[]) {
    const list = await this.getById(listId, tenantId);
    this.ensureDraftStatus(list, 'Można usuwać pozycje tylko w spisie o statusie roboczym');

    const result = await prisma.transferListItem.deleteMany({
      where: {
        id: { in: itemIds },
        transferListId: listId,
      },
    });

    return { deleted: result.count };
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
        box = await prisma.box.findUnique({
          where: { id: boxId },
          select: {
            id: true,
            boxNumber: true,
            title: true,
            location: { select: { id: true, code: true, name: true, fullPath: true } },
          },
        });
      }
    }

    const result = await prisma.transferListItem.updateMany({
      where: {
        id: { in: itemIds },
        transferListId: listId,
      },
      data: { boxId, sourceBoxNumber },
    });

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

    const [data, total] = await Promise.all([
      prisma.transferListItem.findMany({
        where,
        skip,
        take,
        orderBy: { ordinalNumber: 'asc' },
        include: {
          box: { select: TRANSFER_LIST_ITEM_BOX_SELECT },
        },
      }),
      prisma.transferListItem.count({ where }),
    ]);

    return { data, total };
  }
}

export const transferListService = new TransferListService();
