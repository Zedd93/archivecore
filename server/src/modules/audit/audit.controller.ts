import { Request, Response, NextFunction } from 'express';
import { auditService } from './audit.service';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';
import { sanitizeAuditValues } from '../../middleware/audit';

export class AuditController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { skip, take, page, limit } = parsePagination(req.query as any);
      const tenantId = req.tenantId || null;
      const { data, total } = await auditService.list(tenantId, req.query, skip, take);
      return paginatedResponse(res, data.map((log) => ({
        ...log,
        oldValues: log.oldValues === null ? null : sanitizeAuditValues(log.oldValues),
        newValues: log.newValues === null ? null : sanitizeAuditValues(log.newValues),
      })), total, page, limit);
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const log = await auditService.getById(req.params.id);
      if (req.tenantId && log.tenantId !== req.tenantId) return errorResponse(res, 'Log nie znaleziony', 404);
      return successResponse(res, {
        ...log,
        oldValues: log.oldValues === null ? null : sanitizeAuditValues(log.oldValues),
        newValues: log.newValues === null ? null : sanitizeAuditValues(log.newValues),
      });
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

  async revert(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await auditService.revert(req.params.id, req.user!.userId);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }
}

export const auditController = new AuditController();
