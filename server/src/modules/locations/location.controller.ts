import { Request, Response, NextFunction } from 'express';
import { locationService } from './location.service';
import { successResponse, errorResponse } from '../../utils/response';

export class LocationController {
  async getTree(req: Request, res: Response, next: NextFunction) {
    try {
      const tree = await locationService.getTree(req.tenantId || null);
      return successResponse(res, tree);
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const location = await locationService.getById(req.params.id, req.tenantId || null);
      return successResponse(res, location);
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Tenant context required', 400);
      const location = await locationService.create(req.body, req.tenantId);
      return successResponse(res, location, 201);
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Tenant context required', 400);
      const location = await locationService.update(req.params.id, req.tenantId, req.body);
      return successResponse(res, location);
    } catch (err) { next(err); }
  }

  async getAvailableSlots(req: Request, res: Response, next: NextFunction) {
    try {
      const slots = await locationService.getAvailableSlots(req.tenantId || null);
      return successResponse(res, slots);
    } catch (err) { next(err); }
  }

  async getBoxes(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Tenant context required', 400);
      const boxes = await locationService.getBoxes(req.params.id, req.tenantId);
      return successResponse(res, boxes);
    } catch (err) { next(err); }
  }
}

export const locationController = new LocationController();
