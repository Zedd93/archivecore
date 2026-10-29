import { Request, Response, NextFunction } from 'express';
import { attachmentService } from './attachment.service';
import { scanBatchService } from './scan-batch.service';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { Permissions } from '@archivecore/shared';
import { parsePagination } from '../../utils/pagination';
import { recordContentAccess } from '../../middleware/audit';

export class AttachmentController {
  async previewScanBatch(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!req.file) return errorResponse(res, 'Wybierz plik PDF', 400);
      const result = await scanBatchService.preview(req.file, req.tenantId, req.accessDepartment || undefined, req.body.overrides);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async commitScanBatch(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!req.file) return errorResponse(res, 'Wybierz plik PDF', 400);
      const result = await scanBatchService.commit(
        req.file, req.tenantId, req.user!.userId, String(req.body.checksumSha256 || ''), req.accessDepartment || undefined,
        req.body.overrides, String(req.body.planHash || ''),
      );
      return successResponse(res, result, 201);
    } catch (err) { next(err); }
  }

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
        },
        req.accessDepartment || undefined,
      );
      return successResponse(res, attachment, 201);
    } catch (err) { next(err); }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { skip, take, page, limit } = parsePagination(req.query as any);
      const { data, total } = await attachmentService.list(req.tenantId, req.query, skip, take, req.accessDepartment || undefined, req.user!.permissions.includes(Permissions.HR_VIEW));
      return paginatedResponse(res, data, total, page, limit);
    } catch (err) { next(err); }
  }

  async download(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { attachment, buffer } = await attachmentService.download(req.params.id, req.tenantId, req.accessDepartment || undefined, req.user!.permissions.includes(Permissions.HR_VIEW));
      await recordContentAccess(req, 'attachment.download', 'attachment', attachment.id, {
        ...(attachment.documentId ? { documentId: attachment.documentId } : {}),
        ...(attachment.folderId ? { folderId: attachment.folderId } : {}),
        ...(attachment.boxId ? { boxId: attachment.boxId } : {}),
      });
      res.setHeader('Content-Type', attachment.mimeType);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(buffer);
    } catch (err) { next(err); }
  }

  async downloadPeselRedactedCopy(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { attachment, buffer, redactedCount } = await attachmentService.downloadPeselRedactedCopy(
        req.params.id, req.tenantId, req.accessDepartment || undefined, req.user!.permissions.includes(Permissions.HR_VIEW),
      );
      await recordContentAccess(req, 'attachment.redacted_copy.download', 'attachment', attachment.id, {
        redactedCount: String(redactedCount),
        ...(attachment.documentId ? { documentId: attachment.documentId } : {}),
        ...(attachment.folderId ? { folderId: attachment.folderId } : {}),
        ...(attachment.boxId ? { boxId: attachment.boxId } : {}),
      });
      const baseName = attachment.fileName.replace(/\.pdf$/i, '');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${baseName}-pesel-zakryty.pdf`)}`);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(buffer);
    } catch (err) { next(err); }
  }

  async analyzeSensitivity(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const pageInput = req.query.page ?? '1';
      if (typeof pageInput !== 'string' || !/^[1-9]\d*$/.test(pageInput) || Number(pageInput) > 12) {
        return errorResponse(res, 'Podaj numer strony od 1 do 12', 400);
      }
      const { attachment, analysis } = await attachmentService.analyzeSensitivity(
        req.params.id, req.tenantId, Number(pageInput), req.accessDepartment || undefined,
        req.user!.permissions.includes(Permissions.HR_VIEW),
      );
      await recordContentAccess(req, 'attachment.sensitivity.analyze', 'attachment', attachment.id, {
        page: String(analysis.page),
        signalCount: String(analysis.signals.length),
      });
      res.setHeader('Cache-Control', 'private, no-store');
      return successResponse(res, analysis);
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
