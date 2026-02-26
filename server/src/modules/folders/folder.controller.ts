import { Request, Response, NextFunction } from 'express';
import { folderService } from './folder.service';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';

export class FolderController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { skip, take, page, limit } = parsePagination(req.query as any);
      const { data, total } = await folderService.list(req.params.boxId, req.tenantId, skip, take);
      return paginatedResponse(res, data, total, page, limit);
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const folder = await folderService.getById(req.params.id, req.tenantId);
      return successResponse(res, folder);
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const folder = await folderService.create({ ...req.body, boxId: req.params.boxId || req.body.boxId }, req.tenantId);
      return successResponse(res, folder, 201);
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const folder = await folderService.update(req.params.id, req.tenantId, req.body);
      return successResponse(res, folder);
    } catch (err) { next(err); }
  }

  async reorder(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const result = await folderService.reorder(req.params.boxId, req.tenantId, req.body.folderIds);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }
}

export const folderController = new FolderController();
