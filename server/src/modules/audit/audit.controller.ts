import { Request, Response, NextFunction } from 'express';
import { auditService } from './audit.service';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';

export class AuditController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { skip, take, page, limit } = parsePagination(req.query as any);
      const tenantId = req.tenantId || null;
      const { data, total } = await auditService.list(tenantId, req.query, skip, take);
      return paginatedResponse(res, data, total, page, limit);
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const log = await auditService.getById(req.params.id);
      return successResponse(res, log);
    } catch (err) { next(err); }
  }

  async getActions(req: Request, res: Response, next: NextFunction) {
    try {
      const actions = await auditService.getActions();
      return successResponse(res, actions);
    } catch (err) { next(err); }
  }

  async getEntityTypes(req: Request, res: Response, next: NextFunction) {
    try {
      const types = await auditService.getEntityTypes();
      return successResponse(res, types);
    } catch (err) { next(err); }
  }
}

export const auditController = new AuditController();
