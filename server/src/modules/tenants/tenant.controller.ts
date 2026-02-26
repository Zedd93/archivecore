import { Request, Response, NextFunction } from 'express';
import { tenantService } from './tenant.service';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';

export class TenantController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { skip, take, page, limit } = parsePagination(req.query as any);
      const { data, total } = await tenantService.list(req.query, skip, take);
      return paginatedResponse(res, data, total, page, limit);
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = await tenantService.getById(req.params.id);
      return successResponse(res, tenant);
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = await tenantService.create(req.body);
      return successResponse(res, tenant, 201);
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = await tenantService.update(req.params.id, req.body);
      return successResponse(res, tenant);
    } catch (err) { next(err); }
  }

  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await tenantService.getStats(req.params.id);
      return successResponse(res, stats);
    } catch (err) { next(err); }
  }
}

export const tenantController = new TenantController();
