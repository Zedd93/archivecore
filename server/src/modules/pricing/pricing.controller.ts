import { NextFunction, Request, Response } from 'express';
import { successResponse } from '../../utils/response';
import { pricingService } from './pricing.service';

export class PricingController {
  async listForTenant(req: Request, res: Response, next: NextFunction) {
    try {
      return successResponse(res, await pricingService.listForTenant(req.params.tenantId));
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      return successResponse(res, await pricingService.create(req.params.tenantId, req.body), 201);
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      return successResponse(res, await pricingService.update(req.params.id, req.body));
    } catch (err) { next(err); }
  }

  async activate(req: Request, res: Response, next: NextFunction) {
    try {
      return successResponse(res, await pricingService.activate(req.params.id));
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      return successResponse(res, await pricingService.remove(req.params.id));
    } catch (err) { next(err); }
  }
}

export const pricingController = new PricingController();
