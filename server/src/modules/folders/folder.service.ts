import { prisma } from '../../config/database';
import { Prisma, FolderStatus } from '@prisma/client';

export class FolderService {
  async listAll(tenantId: string, filters: any, skip: number, take: number, department?: string) {
    const search = String(filters.search || '').trim();
    const source = String(filters.source || '').trim();
    const boxId = String(filters.boxId || '').trim();

    const folderWhere: Prisma.FolderWhereInput = {
      tenantId,
      ...(boxId ? { boxId } : {}),
      ...(department ? { box: { department: { equals: department, mode: 'insensitive' } } } : {}),
      ...(search ? {
        OR: [
          { folderNumber: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
          { docType: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { box: { boxNumber: { contains: search, mode: 'insensitive' } } },
          { box: { title: { contains: search, mode: 'insensitive' } } },
          { box: { location: { fullPath: { contains: search, mode: 'insensitive' } } } },
        ],
      } : {}),
    };

    const transferWhere: Prisma.TransferListItemWhereInput = {
      transferList: { tenantId },
      ...(boxId ? { boxId } : {}),
      ...(department ? { box: { department: { equals: department, mode: 'insensitive' } } } : {}),
      ...(search ? {
        OR: [
          { folderSignature: { contains: search, mode: 'insensitive' } },
          { folderTitle: { contains: search, mode: 'insensitive' } },
          { categoryCode: { contains: search, mode: 'insensitive' } },
          { sourceBoxNumber: { contains: search, mode: 'insensitive' } },
          { storageLocation: { contains: search, mode: 'insensitive' } },
          { transferList: { listNumber: { contains: search, mode: 'insensitive' } } },
          { transferList: { title: { contains: search, mode: 'insensitive' } } },
          { box: { boxNumber: { contains: search, mode: 'insensitive' } } },
          { box: { title: { contains: search, mode: 'insensitive' } } },
          { box: { location: { fullPath: { contains: search, mode: 'insensitive' } } } },
        ],
      } : {}),
    };

    const [folders, transferItems] = await Promise.all([
      source === 'transfer_list' ? Promise.resolve([]) : prisma.folder.findMany({
        where: folderWhere,
        orderBy: [{ updatedAt: 'desc' }, { orderInBox: 'asc' }],
        include: {
          box: {
            select: {
              id: true,
              boxNumber: true,
              title: true,
              location: { select: { fullPath: true } },
            },
          },
          _count: { select: { documents: true, attachments: true } },
        },
      }),
      source === 'manual' ? Promise.resolve([]) : prisma.transferListItem.findMany({
        where: transferWhere,
        orderBy: [{ transferList: { listNumber: 'desc' } }, { ordinalNumber: 'asc' }],
        include: {
          transferList: { select: { id: true, listNumber: true, title: true, updatedAt: true } },
          box: {
            select: {
              id: true,
              boxNumber: true,
              title: true,
              location: { select: { fullPath: true } },
            },
          },
        },
      }),
    ]);

    const mappedFolders = folders.map((folder) => ({
      id: folder.id,
      source: 'manual',
      folderNumber: folder.folderNumber,
      title: folder.title,
      docType: folder.docType,
      dateFrom: folder.dateFrom,
      dateTo: folder.dateTo,
      status: folder.status,
      folderCount: 1,
      categoryCode: null,
      box: folder.box,
      locationPath: folder.box?.location?.fullPath ?? null,
      transferList: null,
      documentsCount: folder._count.documents,
      attachmentsCount: folder._count.attachments,
      updatedAt: folder.updatedAt,
    }));

    const mappedTransferItems = transferItems.map((item) => ({
      id: item.id,
      source: 'transfer_list',
      folderNumber: item.folderSignature,
      title: item.folderTitle,
      docType: null,
      dateFrom: item.dateFrom,
      dateTo: item.dateTo,
      status: 'active',
      folderCount: item.folderCount,
      categoryCode: item.categoryCode,
      box: item.box,
      sourceBoxNumber: item.sourceBoxNumber,
      locationPath: item.box?.location?.fullPath ?? item.storageLocation ?? null,
      transferList: item.transferList,
      documentsCount: 0,
      attachmentsCount: 0,
      updatedAt: item.transferList.updatedAt,
    }));

    const data = [...mappedFolders, ...mappedTransferItems].sort((a, b) => {
      const dateCompare = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (dateCompare !== 0) return dateCompare;
      return String(a.folderNumber).localeCompare(String(b.folderNumber), 'pl', { numeric: true });
    });

    return { data: data.slice(skip, skip + take), total: data.length };
  }

  async list(boxId: string, tenantId: string, skip: number, take: number, department?: string) {
    const where: Prisma.FolderWhereInput = { boxId, tenantId, ...(department ? { box: { department: { equals: department, mode: 'insensitive' } } } : {}) };

    const [data, total] = await Promise.all([
      prisma.folder.findMany({
        where,
        skip,
        take,
        orderBy: { orderInBox: 'asc' },
        include: {
          _count: { select: { documents: true, attachments: true } },
        },
      }),
      prisma.folder.count({ where }),
    ]);

    return { data, total };
  }

  async getById(id: string, tenantId: string, department?: string) {
    const folder = await prisma.folder.findFirst({
      where: { id, tenantId, ...(department ? { box: { department: { equals: department, mode: 'insensitive' } } } : {}) },
      include: {
        box: { select: { id: true, boxNumber: true, title: true } },
        documents: {
          orderBy: { orderInFolder: 'asc' },
          include: {
            attachments: { select: { id: true, fileName: true, fileSize: true, mimeType: true } },
          },
        },
        _count: { select: { documents: true, attachments: true } },
      },
    });
    if (!folder) throw Object.assign(new Error('Teczka nie znaleziona'), { statusCode: 404 });
    return folder;
  }

  async create(data: any, tenantId: string) {
    // Get next order number in box
    const lastFolder = await prisma.folder.findFirst({
      where: { boxId: data.boxId, tenantId },
      orderBy: { orderInBox: 'desc' },
    });
    const orderInBox = lastFolder ? lastFolder.orderInBox + 1 : 1;

    // Generate folder number
    const box = await prisma.box.findFirst({ where: { id: data.boxId, tenantId } });
    if (!box) throw Object.assign(new Error('Karton nie znaleziony'), { statusCode: 404 });

    const folderNumber = `${box.boxNumber}/T-${orderInBox.toString().padStart(3, '0')}`;

    return prisma.folder.create({
      data: {
        boxId: data.boxId,
        tenantId,
        folderNumber,
        title: data.title,
        docType: data.docType,
        dateFrom: data.dateFrom ? new Date(data.dateFrom) : undefined,
        dateTo: data.dateTo ? new Date(data.dateTo) : undefined,
        description: data.description,
        orderInBox,
        customFields: data.customFields,
      },
      include: {
        box: { select: { id: true, boxNumber: true } },
      },
    });
  }

  async update(id: string, tenantId: string, data: any) {
    await this.getById(id, tenantId);
    return prisma.folder.update({
      where: { id },
      data: {
        title: data.title,
        docType: data.docType,
        dateFrom: data.dateFrom ? new Date(data.dateFrom) : undefined,
        dateTo: data.dateTo ? new Date(data.dateTo) : undefined,
        description: data.description,
        customFields: data.customFields,
      },
    });
  }

  async changeStatus(id: string, tenantId: string, status: FolderStatus) {
    await this.getById(id, tenantId);
    return prisma.folder.update({
      where: { id },
      data: { status },
    });
  }

  async reorder(boxId: string, tenantId: string, folderIds: string[]) {
    const updates = folderIds.map((id, index) =>
      prisma.folder.update({
        where: { id },
        data: { orderInBox: index + 1 },
      })
    );
    await prisma.$transaction(updates);
    return { reordered: true };
  }
}

export const folderService = new FolderService();
