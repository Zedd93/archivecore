import { Request, Response, NextFunction } from 'express';
import { searchService, SearchResult } from './search.service';
import { successResponse, errorResponse } from '../../utils/response';
import { Permissions } from '@archivecore/shared';

function searchTerm(query: string, types: string[]): string {
  const folderNumbers = [...query.matchAll(/(?:^|[^A-Za-z0-9/-])(K-\d{4}-\d+\/T-\d+)(?![A-Za-z0-9/-])/gi)]
    .map((match) => match[1].toUpperCase());
  const boxNumbers = [...query.matchAll(/(?:^|[^A-Za-z0-9/-])(K-\d{4}-\d+)(?![A-Za-z0-9/-])/gi)]
    .map((match) => match[1].toUpperCase());
  const quotedTerms = [...query.matchAll(/"([^"]+)"|„([^”]+)”/g)]
    .map((match) => (match[1] || match[2]).trim());

  const distinct = [...new Set([...folderNumbers, ...boxNumbers, ...quotedTerms])];
  if (distinct.length !== 1 || distinct[0].length < 3) return query;
  if (folderNumbers.length > 0) return types.includes('folder') ? distinct[0] : query;
  if (boxNumbers.length > 0) return types.includes('box') ? distinct[0] : query;
  return types.includes('folder') || types.includes('document') ? distinct[0] : query;
}

export class SearchController {
  async evidence(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const query = req.query.q as string;
      const { results } = await searchService.search(req.tenantId, searchTerm(query, ['box', 'folder', 'document']), {
        types: ['box', 'folder', 'document'],
        canViewHr: false,
        limit: 10,
        offset: 0,
      }, req.accessDepartment || undefined);

      const sources = results.flatMap((result: SearchResult) => {
        if (result.type === 'hr_folder' || result.metadata.source === 'hr_document') return [];
        const isAttachment = result.metadata.source === 'attachment';
        const path = isAttachment
          ? result.metadata.documentId ? `/documents/${result.metadata.documentId}`
            : result.metadata.folderId ? `/folders/${result.metadata.folderId}`
              : result.metadata.boxId ? `/boxes/${result.metadata.boxId}` : null
          : result.type === 'box' ? `/boxes/${result.id}`
            : result.type === 'folder' ? `/folders/${result.id}`
              : result.type === 'document' ? `/documents/${result.id}` : null;
        if (!path) return [];
        return [{
          id: result.id,
          type: isAttachment ? 'attachment' : result.type,
          title: result.title,
          subtitle: result.subtitle,
          href: path,
        }];
      });

      res.setHeader('Cache-Control', 'private, no-store');
      return successResponse(res, { sources });
    } catch (err) { next(err); }
  }

  async search(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { q, types, limit, offset } = req.query;

      if (!q || typeof q !== 'string' || q.trim().length < 2) {
        return errorResponse(res, 'Zapytanie musi mieć co najmniej 2 znaki', 400);
      }

      const requestedTypes = types ? (types as string).split(',') : ['box', 'folder', 'document', 'hr_folder'];
      const typeArray = req.user!.permissions.includes(Permissions.HR_VIEW)
        ? requestedTypes
        : requestedTypes.filter((type) => type !== 'hr_folder');
      const results = await searchService.search(req.tenantId, searchTerm(q as string, typeArray), {
        types: typeArray,
        canViewHr: req.user!.permissions.includes(Permissions.HR_VIEW),
        limit: limit ? parseInt(limit as string) : 20,
        offset: offset ? parseInt(offset as string) : 0,
      }, req.accessDepartment || undefined);

      return successResponse(res, results);
    } catch (err) { next(err); }
  }
}

export const searchController = new SearchController();
