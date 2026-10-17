import { Request, Response, NextFunction } from 'express';
import { errorResponse, successResponse } from '../../utils/response';
import { documentationLegalHoldService, DocumentationHoldTarget } from './documentation-legal-hold.service';

export function setDocumentationLegalHold(target: DocumentationHoldTarget) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const result = await documentationLegalHoldService.setHold(
        target, req.params.id, req.tenantId, req.user!.userId, req.body.hold, req.body.reason,
      );
      return successResponse(res, result);
    } catch (error) { next(error); }
  };
}
