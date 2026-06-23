import { prisma } from '../../config/database';
import { Prisma, Confidentiality } from '@prisma/client';

export class DocumentService {
  async list(tenantId: string, filters: any, skip: number, take: number, department?: string): Promise<{ data: any[]; total: number }> {
    if (filters.loanable === 'true' && filters.search) {
      return this.listLoanable(tenantId, filters, skip, take, department);
    }

    const where: Prisma.DocumentWhereInput = { tenantId, ...(department ? { box: { department: { equals: department, mode: 'insensitive' } } } : {}) };

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

  private getSearchRank(query: string, values: Array<string | null | undefined>) {
    const lowerQuery = query.toLowerCase();
    const normalized = values
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());

    if (normalized.some((value) => value === lowerQuery)) return 0;
    if (normalized.some((value) => value.startsWith(lowerQuery))) return 1;
    if (normalized.some((value) => value.includes(lowerQuery))) return 2;
    return 3;
  }

  private async listLoanable(tenantId: string, filters: any, skip: number, take: number, department?: string) {
    const search = String(filters.search).trim();
    if (!search) return { data: [], total: 0 };
    const insensitive = Prisma.QueryMode.insensitive;
    const includeTransferListItems = filters.includeTransferListItems !== 'false';

    const documentWhere: Prisma.DocumentWhereInput = {
      tenantId,
      AND: [
        {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { docType: { contains: search, mode: 'insensitive' } },
            { box: { boxNumber: { contains: search, mode: 'insensitive' } } },
            { folder: { folderNumber: { contains: search, mode: 'insensitive' } } },
            { folder: { title: { contains: search, mode: 'insensitive' } } },
            { folder: { box: { boxNumber: { contains: search, mode: 'insensitive' } } } },
            { attachments: { some: { fileName: { contains: search, mode: 'insensitive' } } } },
            { attachments: { some: { ocrText: { contains: search, mode: 'insensitive' } } } },
          ],
        },
        ...(department ? [{
          OR: [
            { box: { department: { equals: department, mode: insensitive } } },
            { folder: { box: { department: { equals: department, mode: insensitive } } } },
          ],
        }] : []),
      ],
    };

    const transferListItemWhere: Prisma.TransferListItemWhereInput = {
      transferList: { tenantId },
      AND: [
        {
          OR: [
            { folderTitle: { contains: search, mode: 'insensitive' } },
            { folderSignature: { contains: search, mode: 'insensitive' } },
            { categoryCode: { contains: search, mode: 'insensitive' } },
            { storageLocation: { contains: search, mode: 'insensitive' } },
            { notes: { contains: search, mode: 'insensitive' } },
            { transferList: { title: { contains: search, mode: 'insensitive' } } },
            { transferList: { listNumber: { contains: search, mode: 'insensitive' } } },
            { box: { boxNumber: { contains: search, mode: 'insensitive' } } },
            { box: { title: { contains: search, mode: 'insensitive' } } },
          ],
        },
        ...(department ? [{ box: { department: { equals: department, mode: insensitive } } }] : []),
      ],
    };

    const [documents, transferListItems, documentTotal, transferListItemTotal] = await Promise.all([
      prisma.document.findMany({
        where: documentWhere,
        take: Math.max(take + skip, 500),
        include: {
          folder: { select: { id: true, folderNumber: true, title: true, box: { select: { id: true, boxNumber: true } } } },
          box: { select: { id: true, boxNumber: true } },
        },
      }),
      includeTransferListItems ? prisma.transferListItem.findMany({
        where: transferListItemWhere,
        take: Math.max(take + skip, 500),
        include: {
          box: { select: { id: true, boxNumber: true } },
          transferList: { select: { id: true, listNumber: true, title: true } },
        },
      }) : Promise.resolve([]),
      prisma.document.count({ where: documentWhere }),
      includeTransferListItems ? prisma.transferListItem.count({ where: transferListItemWhere }) : Promise.resolve(0),
    ]);

    const data = [
      ...documents.map((doc) => ({
        id: doc.id,
        title: doc.title,
        docType: doc.docType,
        source: 'document' as const,
        box: doc.box || doc.folder?.box || null,
        folder: doc.folder ? { id: doc.folder.id, folderNumber: doc.folder.folderNumber, title: doc.folder.title } : null,
        rank: this.getSearchRank(search, [
          doc.title,
          doc.description,
          doc.docType,
          doc.box?.boxNumber,
          doc.folder?.folderNumber,
          doc.folder?.title,
          doc.folder?.box?.boxNumber,
        ]),
      })),
      ...transferListItems.map((item) => ({
        id: item.id,
        title: item.folderTitle,
        docType: item.categoryCode,
        source: 'transfer_list_item' as const,
        box: item.box,
        folder: { id: item.id, folderNumber: item.folderSignature, title: item.folderTitle },
        transferList: item.transferList,
        rank: this.getSearchRank(search, [
          item.folderTitle,
          item.folderSignature,
          item.categoryCode,
          item.storageLocation,
          item.notes,
          item.transferList.title,
          item.transferList.listNumber,
          item.box?.boxNumber,
        ]),
      })),
    ].sort((a, b) => (
      a.rank - b.rank
      || a.title.localeCompare(b.title, 'pl', { numeric: true, sensitivity: 'base' })
      || (a.box?.boxNumber || '').localeCompare(b.box?.boxNumber || '', 'pl', { numeric: true, sensitivity: 'base' })
    ));

    return {
      data: data.slice(skip, skip + take).map(({ rank, ...item }) => item),
      total: documentTotal + transferListItemTotal,
    };
  }

  async getById(id: string, tenantId: string, department?: string) {
    const doc = await prisma.document.findFirst({
      where: { id, tenantId, ...(department ? { box: { department: { equals: department, mode: 'insensitive' } } } : {}) },
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
