import { Request, Response, NextFunction } from 'express';
import { searchService } from './search.service';
import { successResponse, errorResponse } from '../../utils/response';

export class SearchController {
  async search(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { q, types, limit, offset } = req.query;

      if (!q || typeof q !== 'string' || q.trim().length < 2) {
        return errorResponse(res, 'Zapytanie musi mieć co najmniej 2 znaki', 400);
      }

      const typeArray = types ? (types as string).split(',') : undefined;
      const results = await searchService.search(req.tenantId, q as string, {
        types: typeArray,
        limit: limit ? parseInt(limit as string) : 20,
        offset: offset ? parseInt(offset as string) : 0,
      });

      return successResponse(res, results);
    } catch (err) { next(err); }
  }
}

export const searchController = new SearchController();
