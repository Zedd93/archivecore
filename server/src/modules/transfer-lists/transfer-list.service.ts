import { prisma } from '../../config/database';
import { generateQrData } from '@archivecore/shared';
import { Prisma } from '@prisma/client';

export class TransferListService {
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
        orderBy: { createdAt: 'desc' },
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
            box: { select: { id: true, boxNumber: true, title: true, qrCode: true } },
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
        title: data.title,
        transferringUnit: data.transferringUnit,
        receivingUnit: data.receivingUnit,
        transferDate: data.transferDate ? new Date(data.transferDate) : undefined,
        notes: data.notes,
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
    await this.getById(id, tenantId);
    return prisma.transferList.update({
      where: { id },
      data: {
        title: data.title,
        transferringUnit: data.transferringUnit,
        receivingUnit: data.receivingUnit,
        transferDate: data.transferDate ? new Date(data.transferDate) : undefined,
        notes: data.notes,
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

  // ─── Resolve boxId from boxNumber or boxId (auto-create if not found) ───
  private async resolveBoxId(tenantId: string, userId: string, data: any): Promise<string | null> {
    if (data.boxId) return data.boxId;

    const boxNumber = data.boxNumber?.trim();
    if (!boxNumber) return null;

    // Try to find existing box
    const existing = await prisma.box.findFirst({
      where: { tenantId, boxNumber: { equals: boxNumber, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) return existing.id;

    // Auto-create new box with this number
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return null;

    const qrCode = generateQrData(tenant.shortCode, boxNumber);

    const newBox = await prisma.box.create({
      data: {
        tenantId,
        title: `Karton ${boxNumber}`,
        boxNumber,
        qrCode,
        createdById: userId,
        status: 'active',
      },
    });

    return newBox.id;
  }

  // ─── Add item to list ──────────────────────────────────
  async addItem(listId: string, tenantId: string, userId: string, data: any) {
    const list = await this.getById(listId, tenantId);
    const boxId = await this.resolveBoxId(list.tenantId, userId, data);

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
      },
      include: {
        box: { select: { id: true, boxNumber: true, title: true, qrCode: true } },
      },
    });
  }

  // ─── Update item ───────────────────────────────────────
  async updateItem(listId: string, itemId: string, tenantId: string, userId: string, data: any) {
    const list = await this.getById(listId, tenantId);
    const boxId = await this.resolveBoxId(list.tenantId, userId, data);

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
      },
      include: {
        box: { select: { id: true, boxNumber: true, title: true, qrCode: true } },
      },
    });
  }

  // ─── Delete item ───────────────────────────────────────
  async deleteItem(listId: string, itemId: string, tenantId: string) {
    await this.getById(listId, tenantId);
    const item = await prisma.transferListItem.findFirst({
      where: { id: itemId, transferListId: listId },
    });
    if (!item) throw Object.assign(new Error('Pozycja spisu nie znaleziona'), { statusCode: 404 });
    await prisma.transferListItem.delete({ where: { id: itemId } });
  }

  // ─── Import items from parsed data (Excel/CSV) ────────
  async importItems(listId: string, tenantId: string, items: any[]) {
    await this.getById(listId, tenantId);

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
            boxId: item.boxId || null,
          },
          include: {
            box: { select: { id: true, boxNumber: true, title: true, qrCode: true } },
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
    if (list.status !== 'draft') {
      throw Object.assign(new Error('Można usuwać pozycje tylko w spisie o statusie roboczym'), { statusCode: 400 });
    }

    const result = await prisma.transferListItem.deleteMany({
      where: {
        id: { in: itemIds },
        transferListId: listId,
      },
    });

    return { deleted: result.count };
  }

  // ─── Bulk assign box to items ────────────────────────
  async bulkAssignBox(listId: string, tenantId: string, userId: string, itemIds: string[], boxNumber: string | null) {
    const list = await this.getById(listId, tenantId);
    if (list.status !== 'draft') {
      throw Object.assign(new Error('Można edytować pozycje tylko w spisie o statusie roboczym'), { statusCode: 400 });
    }

    let boxId: string | null = null;
    if (boxNumber && boxNumber.trim()) {
      boxId = await this.resolveBoxId(tenantId, userId, { boxNumber: boxNumber.trim() });
    }

    const result = await prisma.transferListItem.updateMany({
      where: {
        id: { in: itemIds },
        transferListId: listId,
      },
      data: { boxId },
    });

    return { updated: result.count, boxId };
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
          box: { select: { id: true, boxNumber: true, title: true, qrCode: true } },
        },
      }),
      prisma.transferListItem.count({ where }),
    ]);

    return { data, total };
  }
}

export const transferListService = new TransferListService();
