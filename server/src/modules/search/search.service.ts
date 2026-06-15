import { prisma } from '../../config/database';
import { DOC_TYPE_LABELS } from '@archivecore/shared';
import { Prisma } from '@prisma/client';

export interface SearchResult {
  type: 'box' | 'folder' | 'document' | 'hr_folder';
  id: string;
  title: string;
  subtitle: string;
  relevance: number;
  metadata: Record<string, any>;
}

export class SearchService {
  /**
   * Unified search across all entities using pg_trgm similarity
   * Priority: exact QR/ID match > box number match > fuzzy text match
   */
  async search(tenantId: string, query: string, options: {
    types?: string[];
    limit?: number;
    offset?: number;
  } = {}, department?: string): Promise<{ results: SearchResult[]; total: number }> {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    const types = options.types || ['box', 'folder', 'document', 'hr_folder'];
    const results: SearchResult[] = [];
    const trimmedQuery = query.trim();

    // 1. Check if query is a QR code or exact box number
    if (trimmedQuery.startsWith('AC:') || trimmedQuery.match(/^K-\d{4}-\d+$/)) {
      const boxes = await prisma.box.findMany({
        where: {
          tenantId,
          ...(department ? { department: { equals: department, mode: 'insensitive' } } : {}),
          OR: [
            { qrCode: trimmedQuery },
            { boxNumber: { equals: trimmedQuery, mode: 'insensitive' } },
            { barcode: trimmedQuery },
          ],
        },
        include: {
          location: { select: { fullPath: true } },
          tenant: { select: { name: true } },
        },
        take: 5,
      });

      for (const box of boxes) {
        results.push({
          type: 'box',
          id: box.id,
          title: `${box.boxNumber} — ${box.title}`,
          subtitle: box.location?.fullPath || 'Brak lokalizacji',
          relevance: 1.0,
          metadata: { boxNumber: box.boxNumber, status: box.status, qrCode: box.qrCode },
        });
      }

      if (results.length > 0) {
        return { results, total: results.length };
      }
    }

    // 2. Fuzzy text search using pg_trgm
    const searchPromises: Promise<void>[] = [];

    if (types.includes('box')) {
      searchPromises.push(this.searchBoxes(tenantId, trimmedQuery, limit, department).then(r => { results.push(...r); }));
    }
    if (types.includes('folder')) {
      searchPromises.push(this.searchFolders(tenantId, trimmedQuery, limit, department).then(r => { results.push(...r); }));
      searchPromises.push(this.searchTransferListItems(tenantId, trimmedQuery, limit, department).then(r => { results.push(...r); }));
    }
    if (types.includes('document')) {
      searchPromises.push(this.searchDocuments(tenantId, trimmedQuery, limit, department).then(r => { results.push(...r); }));
      searchPromises.push(this.searchHRDocuments(tenantId, trimmedQuery, limit).then(r => { results.push(...r); }));
      searchPromises.push(this.searchAttachments(tenantId, trimmedQuery, limit, department).then(r => { results.push(...r); }));
    }
    if (types.includes('hr_folder')) {
      searchPromises.push(this.searchHRFolders(tenantId, trimmedQuery, limit).then(r => { results.push(...r); }));
    }

    await Promise.all(searchPromises);

    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance);

    const total = results.length;
    const paginated = results.slice(offset, offset + limit);

    return { results: paginated, total };
  }

  private async searchBoxes(tenantId: string, query: string, limit: number, department?: string): Promise<SearchResult[]> {
    // Use pg_trgm similarity via raw query for better relevance scoring
    const boxes = await prisma.box.findMany({
      where: {
        tenantId,
        ...(department ? { department: { equals: department, mode: 'insensitive' } } : {}),
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { boxNumber: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { notes: { contains: query, mode: 'insensitive' } },
          { docType: { contains: query, mode: 'insensitive' } },
          { keywords: { has: query } },
        ],
      },
      include: {
        location: { select: { fullPath: true } },
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return boxes.map(box => ({
      type: 'box' as const,
      id: box.id,
      title: `${box.boxNumber} — ${box.title}`,
      subtitle: `${box.location?.fullPath || 'Brak lokalizacji'} | ${box.docType ? DOC_TYPE_LABELS[box.docType] || box.docType : '-'}`,
      relevance: this.calculateRelevance(query, [box.title, box.boxNumber, box.description || '', box.notes || '', box.docType || '']),
      metadata: { boxNumber: box.boxNumber, status: box.status, docType: box.docType },
    }));
  }

  private async searchFolders(tenantId: string, query: string, limit: number, department?: string): Promise<SearchResult[]> {
    const folders = await prisma.folder.findMany({
      where: {
        tenantId,
        ...(department ? { box: { department: { equals: department, mode: 'insensitive' } } } : {}),
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { folderNumber: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { docType: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        box: { select: { boxNumber: true } },
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return folders.map(folder => ({
      type: 'folder' as const,
      id: folder.id,
      title: `${folder.folderNumber} — ${folder.title}`,
      subtitle: `Karton: ${folder.box.boxNumber}`,
      relevance: this.calculateRelevance(query, [folder.title, folder.folderNumber, folder.description || '', folder.docType || '']),
      metadata: { folderNumber: folder.folderNumber, boxId: folder.boxId, boxNumber: folder.box.boxNumber, docType: folder.docType },
    }));
  }

  private async searchTransferListItems(tenantId: string, query: string, limit: number, department?: string): Promise<SearchResult[]> {
    const items = await prisma.transferListItem.findMany({
      where: {
        transferList: { tenantId },
        ...(department ? { box: { department: { equals: department, mode: 'insensitive' } } } : {}),
        OR: [
          { folderTitle: { contains: query, mode: 'insensitive' } },
          { folderSignature: { contains: query, mode: 'insensitive' } },
          { categoryCode: { contains: query, mode: 'insensitive' } },
          { storageLocation: { contains: query, mode: 'insensitive' } },
          { notes: { contains: query, mode: 'insensitive' } },
          { transferList: { title: { contains: query, mode: 'insensitive' } } },
          { transferList: { listNumber: { contains: query, mode: 'insensitive' } } },
          { box: { boxNumber: { contains: query, mode: 'insensitive' } } },
        ],
      },
      include: {
        transferList: { select: { id: true, listNumber: true, title: true } },
        box: { select: { id: true, boxNumber: true, department: true } },
      },
      take: limit,
      orderBy: { ordinalNumber: 'asc' },
    });

    return items.map(item => ({
      type: 'folder' as const,
      id: item.id,
      title: `${item.folderSignature} — ${item.folderTitle}`,
      subtitle: `Spis ZO: ${item.transferList.listNumber} | Karton: ${item.box?.boxNumber || '—'}`,
      relevance: this.calculateRelevance(query, [
        item.folderTitle,
        item.folderSignature,
        item.categoryCode,
        item.storageLocation || '',
        item.notes || '',
        item.transferList.title,
        item.transferList.listNumber,
        item.box?.boxNumber || '',
      ]),
      metadata: {
        folderNumber: item.folderSignature,
        boxId: item.boxId,
        boxNumber: item.box?.boxNumber,
        transferListId: item.transferListId,
        transferListNumber: item.transferList.listNumber,
        source: 'transfer_list_item',
        categoryCode: item.categoryCode,
        department: item.box?.department,
      },
    }));
  }

  private async searchDocuments(tenantId: string, query: string, limit: number, department?: string): Promise<SearchResult[]> {
    const documents = await prisma.document.findMany({
      where: {
        tenantId,
        ...(department ? { box: { department: { equals: department, mode: 'insensitive' } } } : {}),
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { docType: { contains: query, mode: 'insensitive' } },
          { attachments: { some: { fileName: { contains: query, mode: 'insensitive' } } } },
          { attachments: { some: { ocrText: { contains: query, mode: 'insensitive' } } } },
        ],
      },
      include: {
        folder: { select: { folderNumber: true, box: { select: { id: true, boxNumber: true, department: true } } } },
        box: { select: { id: true, boxNumber: true, department: true } },
        attachments: { select: { fileName: true, ocrText: true }, take: 3 },
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return documents.map(doc => ({
      type: 'document' as const,
      id: doc.id,
      title: doc.title,
      subtitle: doc.folder
        ? `Teczka: ${doc.folder.folderNumber} | Karton: ${doc.folder.box?.boxNumber || '-'}`
        : `Karton: ${doc.box?.boxNumber || '-'}`,
      relevance: this.calculateRelevance(query, [
        doc.title,
        doc.description || '',
        doc.docType || '',
        ...doc.attachments.flatMap((attachment) => [attachment.fileName, attachment.ocrText || '']),
      ]),
      metadata: {
        docType: doc.docType,
        docDate: doc.docDate,
        boxId: doc.boxId || doc.folder?.box?.id,
        boxNumber: doc.box?.boxNumber || doc.folder?.box?.boxNumber,
        department: doc.box?.department || doc.folder?.box?.department,
      },
    }));
  }

  private async searchHRDocuments(tenantId: string, query: string, limit: number): Promise<SearchResult[]> {
    const documents = await prisma.hRDocument.findMany({
      where: {
        tenantId,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { docType: { contains: query, mode: 'insensitive' } },
          { notes: { contains: query, mode: 'insensitive' } },
          { attachment: { fileName: { contains: query, mode: 'insensitive' } } },
          { attachment: { ocrText: { contains: query, mode: 'insensitive' } } },
        ],
      },
      include: {
        attachment: { select: { fileName: true, ocrText: true } },
        hrFolderPart: {
          select: {
            partCode: true,
            hrFolder: {
              select: {
                id: true,
                employeeFirstName: true,
                employeeLastName: true,
                department: true,
                boxId: true,
                box: { select: { id: true, boxNumber: true } },
              },
            },
          },
        },
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return documents.map(doc => {
      const folder = doc.hrFolderPart.hrFolder;
      return {
        type: 'document' as const,
        id: doc.id,
        title: doc.title,
        subtitle: `Akta osobowe: ${folder.employeeLastName} ${folder.employeeFirstName} | Część ${doc.hrFolderPart.partCode}`,
        relevance: this.calculateRelevance(query, [
          doc.title,
          doc.docType || '',
          doc.notes || '',
          doc.attachment?.fileName || '',
          doc.attachment?.ocrText || '',
          folder.employeeLastName,
          folder.employeeFirstName,
        ]),
        metadata: {
          docType: doc.docType,
          docDate: doc.docDate,
          hrFolderId: folder.id,
          boxId: folder.boxId,
          boxNumber: folder.box?.boxNumber,
          department: folder.department,
          source: 'hr_document',
        },
      };
    });
  }

  private async searchAttachments(tenantId: string, query: string, limit: number, department?: string): Promise<SearchResult[]> {
    const attachments = await prisma.attachment.findMany({
      where: {
        tenantId,
        ...(department ? {
          OR: [
            { box: { department: { equals: department, mode: 'insensitive' } } },
            { folder: { box: { department: { equals: department, mode: 'insensitive' } } } },
            { document: { box: { department: { equals: department, mode: 'insensitive' } } } },
            { document: { folder: { box: { department: { equals: department, mode: 'insensitive' } } } } },
          ],
        } : {}),
        AND: [
          {
            OR: [
              { fileName: { contains: query, mode: 'insensitive' } },
              { ocrText: { contains: query, mode: 'insensitive' } },
              { document: { title: { contains: query, mode: 'insensitive' } } },
              { folder: { title: { contains: query, mode: 'insensitive' } } },
              { box: { title: { contains: query, mode: 'insensitive' } } },
              { box: { boxNumber: { contains: query, mode: 'insensitive' } } },
            ],
          },
        ],
      },
      include: {
        box: { select: { id: true, boxNumber: true, title: true, department: true } },
        folder: { select: { id: true, folderNumber: true, title: true, box: { select: { id: true, boxNumber: true, department: true } } } },
        document: { select: { id: true, title: true, box: { select: { id: true, boxNumber: true, department: true } }, folder: { select: { box: { select: { id: true, boxNumber: true, department: true } } } } } },
      },
      take: limit,
      orderBy: { uploadedAt: 'desc' },
    });

    return attachments.map(attachment => {
      const box = attachment.box || attachment.folder?.box || attachment.document?.box || attachment.document?.folder?.box;
      const relatedTitle = attachment.document?.title || attachment.folder?.title || attachment.box?.title || attachment.fileName;
      return {
        type: 'document' as const,
        id: attachment.id,
        title: attachment.fileName,
        subtitle: `${relatedTitle} | Karton: ${box?.boxNumber || '—'}`,
        relevance: this.calculateRelevance(query, [
          attachment.fileName,
          attachment.ocrText || '',
          attachment.document?.title || '',
          attachment.folder?.title || '',
          attachment.box?.title || '',
          box?.boxNumber || '',
        ]),
        metadata: {
          boxId: box?.id,
          boxNumber: box?.boxNumber,
          department: box?.department,
          source: 'attachment',
          mimeType: attachment.mimeType,
        },
      };
    });
  }

  private async searchHRFolders(tenantId: string, query: string, limit: number): Promise<SearchResult[]> {
    const folders = await prisma.hRFolder.findMany({
      where: {
        tenantId,
        OR: [
          { employeeFirstName: { contains: query, mode: 'insensitive' } },
          { employeeLastName: { contains: query, mode: 'insensitive' } },
          { department: { contains: query, mode: 'insensitive' } },
          { position: { contains: query, mode: 'insensitive' } },
          { notes: { contains: query, mode: 'insensitive' } },
          { parts: { some: { description: { contains: query, mode: 'insensitive' } } } },
          { parts: { some: { hrDocuments: { some: { title: { contains: query, mode: 'insensitive' } } } } } },
        ],
      },
      select: {
        id: true,
        employeeFirstName: true,
        employeeLastName: true,
        department: true,
        position: true,
        notes: true,
        employmentStatus: true,
        createdAt: true,
        parts: { select: { description: true }, take: 5 },
      },
      take: limit,
      orderBy: { employeeLastName: 'asc' },
    });

    return folders.map(folder => ({
      type: 'hr_folder' as const,
      id: folder.id,
      title: `${folder.employeeLastName} ${folder.employeeFirstName}`,
      subtitle: `${folder.department || '-'} | ${folder.position || '-'}`,
      relevance: this.calculateRelevance(query, [
        folder.employeeLastName,
        folder.employeeFirstName,
        folder.department || '',
        folder.position || '',
        folder.notes || '',
        ...folder.parts.map((part) => part.description || ''),
      ]),
      metadata: { employmentStatus: folder.employmentStatus, department: folder.department },
    }));
  }

  /**
   * Simple trigram-like relevance scoring
   */
  private calculateRelevance(query: string, fields: string[]): number {
    const q = query.toLowerCase();
    let maxScore = 0;

    for (const field of fields) {
      const f = field.toLowerCase();
      if (f === q) { maxScore = Math.max(maxScore, 1.0); continue; }
      if (f.startsWith(q)) { maxScore = Math.max(maxScore, 0.9); continue; }
      if (f.includes(q)) { maxScore = Math.max(maxScore, 0.7); continue; }

      // Trigram overlap approximation
      const qTrigrams = this.trigrams(q);
      const fTrigrams = this.trigrams(f);
      if (qTrigrams.length > 0 && fTrigrams.length > 0) {
        const intersection = qTrigrams.filter(t => fTrigrams.includes(t)).length;
        const union = new Set([...qTrigrams, ...fTrigrams]).size;
        const similarity = union > 0 ? intersection / union : 0;
        maxScore = Math.max(maxScore, similarity * 0.6);
      }
    }

    return maxScore;
  }

  private trigrams(str: string): string[] {
    const padded = `  ${str} `;
    const result: string[] = [];
    for (let i = 0; i < padded.length - 2; i++) {
      result.push(padded.substring(i, i + 3));
    }
    return result;
  }
}

export const searchService = new SearchService();
