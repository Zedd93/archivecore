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
      ...(source === 'transfer_list' ? { transferListItem: { isNot: null } } : {}),
      ...(source === 'manual' ? { transferListItem: { is: null } } : {}),
      ...(department ? { box: { is: { department: { equals: department, mode: 'insensitive' } } } } : {}),
      ...(search ? {
        OR: [
          { folderNumber: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
          { docType: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { box: { is: { boxNumber: { contains: search, mode: 'insensitive' } } } },
          { box: { is: { title: { contains: search, mode: 'insensitive' } } } },
          { box: { is: { location: { is: { fullPath: { contains: search, mode: 'insensitive' } } } } } },
          { transferListItem: { is: { categoryCode: { contains: search, mode: 'insensitive' } } } },
          { transferListItem: { is: { sourceBoxNumber: { contains: search, mode: 'insensitive' } } } },
          { transferListItem: { is: { storageLocation: { contains: search, mode: 'insensitive' } } } },
          { transferListItem: { is: { transferList: { listNumber: { contains: search, mode: 'insensitive' } } } } },
          { transferListItem: { is: { transferList: { title: { contains: search, mode: 'insensitive' } } } } },
        ],
      } : {}),
    };

    const [folders, total] = await Promise.all([
      prisma.folder.findMany({
        where: folderWhere,
        skip,
        take,
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
          transferListItem: {
            include: {
              transferList: { select: { id: true, listNumber: true, title: true, updatedAt: true } },
            },
          },
          _count: { select: { documents: true, attachments: true } },
        },
      }),
      prisma.folder.count({ where: folderWhere }),
    ]);

    const data = folders.map((folder) => {
      const sourceItem = folder.transferListItem;
      return {
        id: folder.id,
        source: sourceItem ? 'transfer_list' : 'manual',
        folderNumber: folder.folderNumber,
        title: folder.title,
        docType: folder.docType,
        dateFrom: folder.dateFrom,
        dateTo: folder.dateTo,
        status: folder.status,
        folderCount: sourceItem?.folderCount ?? 1,
        categoryCode: sourceItem?.categoryCode ?? null,
        box: folder.box,
        sourceBoxNumber: sourceItem?.sourceBoxNumber ?? null,
        locationPath: folder.box?.location?.fullPath ?? sourceItem?.storageLocation ?? null,
        transferList: sourceItem?.transferList ?? null,
        transferListItemId: sourceItem?.id ?? null,
        documentsCount: folder._count.documents,
        attachmentsCount: folder._count.attachments,
        updatedAt: folder.updatedAt,
      };
    });

    return { data, total };
  }

  async list(boxId: string, tenantId: string, skip: number, take: number, department?: string) {
    const where: Prisma.FolderWhereInput = { boxId, tenantId, ...(department ? { box: { is: { department: { equals: department, mode: 'insensitive' } } } } : {}) };

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
      where: { id, tenantId, ...(department ? { box: { is: { department: { equals: department, mode: 'insensitive' } } } } : {}) },
      include: {
        box: {
          select: {
            id: true,
            boxNumber: true,
            title: true,
            location: { select: { fullPath: true } },
          },
        },
        transferListItem: {
          select: {
            id: true,
            categoryCode: true,
            sourceBoxNumber: true,
            transferList: { select: { id: true, listNumber: true, title: true, status: true } },
          },
        },
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
    const box = await prisma.box.findFirst({ where: { id: data.boxId, tenantId, deletedAt: null } });
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
    const folder = await prisma.folder.findFirst({
      where: { id, tenantId },
      include: {
        transferListItem: {
          select: {
            id: true,
            transferList: { select: { status: true } },
          },
        },
      },
    });
    if (!folder) throw Object.assign(new Error('Teczka nie znaleziona'), { statusCode: 404 });

    const mirroredFieldsChanged = ['title', 'dateFrom', 'dateTo', 'description']
      .some((field) => data[field] !== undefined);
    if (
      mirroredFieldsChanged
      && folder.transferListItem
      && folder.transferListItem.transferList.status !== 'draft'
    ) {
      throw Object.assign(
        new Error('Dane teczki należącej do zatwierdzonego spisu można zmienić dopiero po cofnięciu spisu do statusu Roboczy.'),
        { statusCode: 409 }
      );
    }

    const dateFrom = data.dateFrom === undefined ? undefined : data.dateFrom ? new Date(data.dateFrom) : null;
    const dateTo = data.dateTo === undefined ? undefined : data.dateTo ? new Date(data.dateTo) : null;

    return prisma.$transaction(async (tx) => {
      const updatedFolder = await tx.folder.update({
        where: { id },
        data: {
          title: data.title,
          docType: data.docType,
          dateFrom,
          dateTo,
          description: data.description,
          customFields: data.customFields,
        },
        include: {
          box: { select: { id: true, boxNumber: true, title: true } },
          transferListItem: {
            select: {
              id: true,
              transferList: { select: { id: true, listNumber: true, title: true, status: true } },
            },
          },
        },
      });

      if (folder.transferListItem) {
        await tx.transferListItem.update({
          where: { id: folder.transferListItem.id },
          data: {
            folderTitle: data.title,
            dateFrom,
            dateTo,
            notes: data.description,
          },
        });
      }

      return updatedFolder;
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
    const uniqueFolderIds = [...new Set(folderIds)];
    if (uniqueFolderIds.length !== folderIds.length) {
      throw Object.assign(new Error('Lista teczek zawiera powtórzone pozycje'), { statusCode: 400 });
    }

    const matchingFolders = await prisma.folder.count({
      where: { id: { in: uniqueFolderIds }, boxId, tenantId },
    });
    if (matchingFolders !== uniqueFolderIds.length) {
      throw Object.assign(
        new Error('Niektóre teczki nie należą do wybranego kartonu lub tenanta'),
        { statusCode: 400 }
      );
    }

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
