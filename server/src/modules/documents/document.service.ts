import { prisma } from '../../config/database';
import { Prisma, Confidentiality } from '@prisma/client';

export class DocumentService {
  async list(tenantId: string, filters: any, skip: number, take: number) {
    const where: Prisma.DocumentWhereInput = { tenantId };

    if (filters.folderId) where.folderId = filters.folderId;
    if (filters.boxId) where.boxId = filters.boxId;
    if (filters.docType) where.docType = filters.docType;
    if (filters.confidentiality) where.confidentiality = filters.confidentiality as Confidentiality;
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.document.findMany({
        where,
        skip,
        take,
        orderBy: filters.folderId ? { orderInFolder: 'asc' } : { createdAt: 'desc' },
        include: {
          folder: { select: { id: true, folderNumber: true, title: true } },
          box: { select: { id: true, boxNumber: true } },
          attachments: { select: { id: true, fileName: true, fileSize: true, mimeType: true } },
        },
      }),
      prisma.document.count({ where }),
    ]);

    return { data, total };
  }

  async getById(id: string, tenantId: string) {
    const doc = await prisma.document.findFirst({
      where: { id, tenantId },
      include: {
        folder: { select: { id: true, folderNumber: true, title: true, boxId: true } },
        box: { select: { id: true, boxNumber: true, title: true } },
        attachments: {
          select: { id: true, fileName: true, fileSize: true, mimeType: true, uploadedAt: true, version: true },
          orderBy: { version: 'desc' },
        },
      },
    });
    if (!doc) throw Object.assign(new Error('Dokument nie znaleziony'), { statusCode: 404 });
    return doc;
  }

  async create(data: any, tenantId: string) {
    // Get next order number in folder
    let orderInFolder: number | undefined;
    if (data.folderId) {
      const lastDoc = await prisma.document.findFirst({
        where: { folderId: data.folderId },
        orderBy: { orderInFolder: 'desc' },
      });
      orderInFolder = lastDoc?.orderInFolder ? lastDoc.orderInFolder + 1 : 1;
    }

    return prisma.document.create({
      data: {
        tenantId,
        folderId: data.folderId,
        boxId: data.boxId,
        title: data.title,
        docType: data.docType,
        docDate: data.docDate ? new Date(data.docDate) : undefined,
        pageCount: data.pageCount,
        description: data.description,
        confidentiality: data.confidentiality || 'normal',
        orderInFolder,
        customFields: data.customFields,
      },
      include: {
        folder: { select: { id: true, folderNumber: true } },
        box: { select: { id: true, boxNumber: true } },
      },
    });
  }

  async update(id: string, tenantId: string, data: any) {
    await this.getById(id, tenantId);
    return prisma.document.update({
      where: { id },
      data: {
        title: data.title,
        docType: data.docType,
        docDate: data.docDate ? new Date(data.docDate) : undefined,
        pageCount: data.pageCount,
        description: data.description,
        confidentiality: data.confidentiality,
        customFields: data.customFields,
      },
    });
  }

  async delete(id: string, tenantId: string) {
    await this.getById(id, tenantId);
    await prisma.document.delete({ where: { id } });
    return { deleted: true };
  }
}

export const documentService = new DocumentService();
