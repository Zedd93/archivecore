import { Request, Response, NextFunction } from 'express';
import { retentionService } from './retention.service';
import { successResponse, errorResponse } from '../../utils/response';

export class RetentionController {
  async listPolicies(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const policies = await retentionService.listPolicies(req.tenantId);
      return successResponse(res, policies);
    } catch (err) { next(err); }
  }

  async getPolicy(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const policy = await retentionService.getPolicy(req.params.id, req.tenantId);
      return successResponse(res, policy);
    } catch (err) { next(err); }
  }

  async createPolicy(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const policy = await retentionService.createPolicy(req.tenantId, req.body);
      return successResponse(res, policy, 201);
    } catch (err) { next(err); }
  }

  async updatePolicy(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const policy = await retentionService.updatePolicy(req.params.id, req.tenantId, req.body);
      return successResponse(res, policy);
    } catch (err) { next(err); }
  }

  async deletePolicy(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const result = await retentionService.deletePolicy(req.params.id, req.tenantId);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async recalculate(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const result = await retentionService.recalculateForPolicy(req.params.id, req.tenantId);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async getBoxesForReview(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const days = parseInt(req.query.days as string) || 90;
      const boxes = await retentionService.getBoxesForReview(req.tenantId, days);
      return successResponse(res, boxes);
    } catch (err) { next(err); }
  }

  async initiateDisposal(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const result = await retentionService.initiateDisposal(req.tenantId, req.body.boxIds, req.body.notes);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async approveDisposal(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const result = await retentionService.approveDisposal(req.tenantId, req.body.boxIds);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }
}

export const retentionController = new RetentionController();
