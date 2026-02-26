import { Request, Response, NextFunction } from 'express';
import { userService } from './user.service';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';

export class UserController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { skip, take, page, limit } = parsePagination(req.query as any);
      const tenantId = req.tenantId || null;
      const { data, total } = await userService.list(tenantId, req.query, skip, take);
      return paginatedResponse(res, data, total, page, limit);
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.getById(req.params.id, req.tenantId);
      return successResponse(res, user);
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.create(req.body, req.tenantId || null, req.user?.userId);
      return successResponse(res, user, 201);
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.update(req.params.id, req.tenantId || null, req.body);
      return successResponse(res, user);
    } catch (err) { next(err); }
  }

  async assignRoles(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.assignRoles(req.params.id, req.body.roleIds, req.user!.userId);
      return successResponse(res, user);
    } catch (err) { next(err); }
  }

  async deactivate(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await userService.deactivate(req.params.id, req.tenantId || null);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async getRoles(req: Request, res: Response, next: NextFunction) {
    try {
      const roles = await userService.getRoles(req.tenantId || null);
      return successResponse(res, roles);
    } catch (err) { next(err); }
  }

  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.getById(req.user!.userId);
      return successResponse(res, user);
    } catch (err) { next(err); }
  }
}

export const userController = new UserController();
