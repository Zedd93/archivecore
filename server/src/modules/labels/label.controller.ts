import { Request, Response, NextFunction } from 'express';
import { labelService } from './label.service';
import { successResponse, errorResponse } from '../../utils/response';

export class LabelController {
  async getTemplates(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const templates = await labelService.getTemplates(req.tenantId);
      return successResponse(res, templates);
    } catch (err) { next(err); }
  }

  async createTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const template = await labelService.createTemplate(req.tenantId, req.body);
      return successResponse(res, template, 201);
    } catch (err) { next(err); }
  }

  async generateForBox(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { templateId } = req.query;
      const pdf = await labelService.generateForBox(
        req.params.boxId, req.tenantId, templateId as string, req.user!.userId
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="label-${req.params.boxId}.pdf"`);
      return res.send(pdf);
    } catch (err) { next(err); }
  }

  async generateForBoxes(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { boxIds, templateId } = req.body;
      if (!boxIds || !Array.isArray(boxIds) || boxIds.length === 0) {
        return errorResponse(res, 'Wymagana lista ID kartonów', 400);
      }
      const pdf = await labelService.generateForBoxes(boxIds, req.tenantId, templateId, req.user!.userId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="labels-batch.pdf"');
      return res.send(pdf);
    } catch (err) { next(err); }
  }

  async getQrCode(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const format = (req.query.format as string) || 'png';
      const result = await labelService.getQrCodeImage(
        req.params.boxId, req.tenantId, format as 'png' | 'svg' | 'dataurl'
      );
      res.setHeader('Content-Type', result.contentType);
      return res.send(result.data);
    } catch (err) { next(err); }
  }
}

export const labelController = new LabelController();
