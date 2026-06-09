import { Request, Response, NextFunction } from 'express';
import { searchService } from './search.service';
import { successResponse, errorResponse } from '../../utils/response';
import { Permissions } from '@archivecore/shared';

export class SearchController {
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
      const results = await searchService.search(req.tenantId, q as string, {
        types: typeArray,
        limit: limit ? parseInt(limit as string) : 20,
        offset: offset ? parseInt(offset as string) : 0,
      }, req.accessDepartment || undefined);

      return successResponse(res, results);
    } catch (err) { next(err); }
  }
}

export const searchController = new SearchController();
