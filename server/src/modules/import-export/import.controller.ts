import { Request, Response, NextFunction } from 'express';
import { importService } from './import.service';
import { successResponse, errorResponse } from '../../utils/response';

export class ImportController {

  async previewBoxes(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!req.file) return errorResponse(res, 'Nie załączono pliku', 400);

      const result = await importService.previewBoxes(req.file.buffer, req.file.originalname);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async importBoxes(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!req.file) return errorResponse(res, 'Nie załączono pliku', 400);

      const result = await importService.importBoxes(
        req.file.buffer,
        req.file.originalname,
        req.tenantId,
        req.user!.userId
      );
      return successResponse(res, result, 201);
    } catch (err) { next(err); }
  }

  async previewHR(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!req.file) return errorResponse(res, 'Nie załączono pliku', 400);

      const result = await importService.previewHR(req.file.buffer, req.file.originalname);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async importHR(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!req.file) return errorResponse(res, 'Nie załączono pliku', 400);

      const result = await importService.importHR(
        req.file.buffer,
        req.file.originalname,
        req.tenantId,
        req.user!.userId
      );
      return successResponse(res, result, 201);
    } catch (err) { next(err); }
  }
}

export const importController = new ImportController();
