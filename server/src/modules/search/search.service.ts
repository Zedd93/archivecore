import { prisma } from '../../config/database';
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
  } = {}): Promise<{ results: SearchResult[]; total: number }> {
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
      searchPromises.push(this.searchBoxes(tenantId, trimmedQuery, limit).then(r => { results.push(...r); }));
    }
    if (types.includes('folder')) {
      searchPromises.push(this.searchFolders(tenantId, trimmedQuery, limit).then(r => { results.push(...r); }));
    }
    if (types.includes('document')) {
      searchPromises.push(this.searchDocuments(tenantId, trimmedQuery, limit).then(r => { results.push(...r); }));
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

  private async searchBoxes(tenantId: string, query: string, limit: number): Promise<SearchResult[]> {
    // Use pg_trgm similarity via raw query for better relevance scoring
    const boxes = await prisma.box.findMany({
      where: {
        tenantId,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { boxNumber: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
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
      subtitle: `${box.location?.fullPath || 'Brak lokalizacji'} | ${box.docType || '-'}`,
      relevance: this.calculateRelevance(query, [box.title, box.boxNumber, box.description || '']),
      metadata: { boxNumber: box.boxNumber, status: box.status, docType: box.docType },
    }));
  }

  private async searchFolders(tenantId: string, query: string, limit: number): Promise<SearchResult[]> {
    const folders = await prisma.folder.findMany({
      where: {
        tenantId,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { folderNumber: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
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
      relevance: this.calculateRelevance(query, [folder.title, folder.folderNumber]),
      metadata: { folderNumber: folder.folderNumber, boxNumber: folder.box.boxNumber },
    }));
  }

  private async searchDocuments(tenantId: string, query: string, limit: number): Promise<SearchResult[]> {
    const documents = await prisma.document.findMany({
      where: {
        tenantId,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { docType: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        folder: { select: { folderNumber: true, box: { select: { boxNumber: true } } } },
        box: { select: { boxNumber: true } },
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
      relevance: this.calculateRelevance(query, [doc.title, doc.description || '']),
      metadata: { docType: doc.docType, docDate: doc.docDate },
    }));
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
        ],
      },
      select: {
        id: true,
        employeeFirstName: true,
        employeeLastName: true,
        department: true,
        position: true,
        employmentStatus: true,
        createdAt: true,
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
        folder.employeeLastName, folder.employeeFirstName, folder.department || '', folder.position || '',
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
