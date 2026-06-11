import { Request, Response, NextFunction } from 'express';
import { locationService } from './location.service';
import { successResponse, errorResponse } from '../../utils/response';
import { Permissions, RoleCode } from '@archivecore/shared';

function canSelectLocationTenant(req: Request) {
  return !req.user?.tenantId && (
    req.user?.roles.includes(RoleCode.SUPER_ADMIN) ||
    req.user?.permissions.includes(Permissions.TENANT_MANAGE) ||
    req.user?.permissions.includes(Permissions.TENANT_SWITCH)
  );
}

export class LocationController {
  async getTree(req: Request, res: Response, next: NextFunction) {
    try {
      const selectedTenantId = canSelectLocationTenant(req)
        ? (req.query.tenantId as string | undefined) || req.tenantId || null
        : req.tenantId || null;
      const tree = await locationService.getTree(selectedTenantId);
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
      const selectedTenantId = canSelectLocationTenant(req)
        ? req.body.tenantId || req.tenantId || null
        : req.tenantId || null;

      if (!selectedTenantId && !canSelectLocationTenant(req)) {
        return errorResponse(res, 'Tenant context required', 400);
      }

      const location = await locationService.create(req.body, selectedTenantId);
      return successResponse(res, location, 201);
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId && !canSelectLocationTenant(req)) return errorResponse(res, 'Tenant context required', 400);
      const location = await locationService.update(req.params.id, req.tenantId || null, req.body);
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
