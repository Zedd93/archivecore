import { Request, Response, NextFunction } from 'express';
import { hrService } from './hr.service';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';

export class HRController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { skip, take, page, limit } = parsePagination(req.query as any);
      const { data, total } = await hrService.list(req.tenantId, req.query, skip, take);
      return paginatedResponse(res, data, total, page, limit);
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      // Check if user has PESEL viewing permission
      const canViewPesel = req.user?.permissions?.includes('hr.view_pesel') ?? false;
      const folder = await hrService.getById(req.params.id, req.tenantId, canViewPesel);
      return successResponse(res, folder);
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const folder = await hrService.create(req.body, req.tenantId);
      return successResponse(res, folder, 201);
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const folder = await hrService.update(req.params.id, req.tenantId, req.body);
      return successResponse(res, folder);
    } catch (err) { next(err); }
  }

  async searchByPesel(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const folders = await hrService.searchByPesel(req.tenantId, req.body.pesel);
      return successResponse(res, folders);
    } catch (err) { next(err); }
  }

  async addDocument(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const doc = await hrService.addDocument(req.params.partId, req.tenantId, req.body);
      return successResponse(res, doc, 201);
    } catch (err) { next(err); }
  }

  async removeDocument(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const result = await hrService.removeDocument(req.params.docId, req.tenantId);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async setLitigationHold(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { hold, until, notes } = req.body;
      const folder = await hrService.setLitigationHold(req.params.id, req.tenantId, hold, until, notes);
      return successResponse(res, folder);
    } catch (err) { next(err); }
  }

  async getRetentionExpiring(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const days = parseInt(req.query.days as string) || 90;
      const folders = await hrService.getRetentionExpiring(req.tenantId, days);
      return successResponse(res, folders);
    } catch (err) { next(err); }
  }
}

export const hrController = new HRController();
