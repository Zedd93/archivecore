import { Request, Response, NextFunction } from 'express';
import { exportService } from './export.service';
import { errorResponse } from '../../utils/response';

export class ExportController {

  async exportBoxes(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const format = (req.query.format as string) === 'csv' ? 'csv' : 'xlsx';
      const { buffer, filename, contentType } = await exportService.exportBoxes(req.tenantId, req.query, format);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) { next(err); }
  }

  async exportOrders(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const format = (req.query.format as string) === 'csv' ? 'csv' : 'xlsx';
      const { buffer, filename, contentType } = await exportService.exportOrders(req.tenantId, req.query, format);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) { next(err); }
  }

  async exportHR(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const format = (req.query.format as string) === 'csv' ? 'csv' : 'xlsx';
      const { buffer, filename, contentType } = await exportService.exportHR(req.tenantId, req.query, format);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) { next(err); }
  }

  async exportTransferLists(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const format = (req.query.format as string) === 'csv' ? 'csv' : 'xlsx';
      const { buffer, filename, contentType } = await exportService.exportTransferLists(req.tenantId, req.query, format);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) { next(err); }
  }
}

export const exportController = new ExportController();
