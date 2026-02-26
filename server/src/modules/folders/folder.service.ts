import { prisma } from '../../config/database';
import { Prisma, FolderStatus } from '@prisma/client';

export class FolderService {
  async list(boxId: string, tenantId: string, skip: number, take: number) {
    const where: Prisma.FolderWhereInput = { boxId, tenantId };

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

  async getById(id: string, tenantId: string) {
    const folder = await prisma.folder.findFirst({
      where: { id, tenantId },
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
