import { Request, Response, NextFunction } from 'express';
import { boxService } from './box.service';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';

export class BoxController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { skip, take, page, limit } = parsePagination(req.query as any);
      const { data, total } = await boxService.list(req.tenantId, req.query, skip, take);
      return paginatedResponse(res, data, total, page, limit);
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const box = await boxService.getById(req.params.id, req.tenantId);
      return successResponse(res, box);
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const box = await boxService.create(req.body, req.tenantId, req.user!.userId);
      return successResponse(res, box, 201);
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const box = await boxService.update(req.params.id, req.tenantId, req.body);
      return successResponse(res, box);
    } catch (err) { next(err); }
  }

  async move(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { locationId, notes } = req.body;
      const box = await boxService.move(req.params.id, req.tenantId, locationId, notes);
      return successResponse(res, box);
    } catch (err) { next(err); }
  }

  async changeStatus(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { status } = req.body;
      const box = await boxService.changeStatus(req.params.id, req.tenantId, status);
      return successResponse(res, box);
    } catch (err) { next(err); }
  }

  async bulkChangeStatus(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { ids, status } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return errorResponse(res, 'Brak ID', 400);
      if (!status) return errorResponse(res, 'Brak statusu', 400);
      const result = await boxService.bulkChangeStatus(ids, req.tenantId, status);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async bulkMove(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { ids, locationId } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return errorResponse(res, 'Brak ID', 400);
      if (!locationId) return errorResponse(res, 'Brak lokalizacji', 400);
      const result = await boxService.bulkMove(ids, req.tenantId, locationId);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async getHistory(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const history = await boxService.getHistory(req.params.id, req.tenantId);
      return successResponse(res, history);
    } catch (err) { next(err); }
  }
}

export const boxController = new BoxController();
