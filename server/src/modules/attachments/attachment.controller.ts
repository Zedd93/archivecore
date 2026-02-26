import { Request, Response, NextFunction } from 'express';
import { attachmentService } from './attachment.service';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';

export class AttachmentController {
  async upload(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!req.file) return errorResponse(res, 'Brak pliku', 400);

      const attachment = await attachmentService.upload(
        req.file,
        req.tenantId,
        req.user!.userId,
        {
          documentId: req.body.documentId,
          folderId: req.body.folderId,
          boxId: req.body.boxId,
        }
      );
      return successResponse(res, attachment, 201);
    } catch (err) { next(err); }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { skip, take, page, limit } = parsePagination(req.query as any);
      const { data, total } = await attachmentService.list(req.tenantId, req.query, skip, take);
      return paginatedResponse(res, data, total, page, limit);
    } catch (err) { next(err); }
  }

  async getDownloadUrl(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const url = await attachmentService.getDownloadUrl(req.params.id, req.tenantId);
      return successResponse(res, { url });
    } catch (err) { next(err); }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const result = await attachmentService.delete(req.params.id, req.tenantId);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }
}

export const attachmentController = new AttachmentController();
