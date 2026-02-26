import { Request, Response, NextFunction } from 'express';
import { reportService } from './report.service';
import { successResponse, errorResponse } from '../../utils/response';

export class ReportController {
  async getDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const kpis = await reportService.getDashboardKPIs(req.tenantId);
      return successResponse(res, kpis);
    } catch (err) { next(err); }
  }

  async getBoxesByStatus(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const data = await reportService.getBoxesByStatus(req.tenantId);
      return successResponse(res, data);
    } catch (err) { next(err); }
  }

  async getBoxesByDocType(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const data = await reportService.getBoxesByDocType(req.tenantId);
      return successResponse(res, data);
    } catch (err) { next(err); }
  }

  async getOrdersByStatus(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const data = await reportService.getOrdersByStatus(req.tenantId);
      return successResponse(res, data);
    } catch (err) { next(err); }
  }

  async getOrdersByMonth(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const months = parseInt(req.query.months as string) || 12;
      const data = await reportService.getOrdersByMonth(req.tenantId, months);
      return successResponse(res, data);
    } catch (err) { next(err); }
  }

  async getLocationOccupancy(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const data = await reportService.getLocationOccupancy(req.tenantId);
      return successResponse(res, data);
    } catch (err) { next(err); }
  }

  async getHRFoldersByDepartment(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const data = await reportService.getHRFoldersByDepartment(req.tenantId);
      return successResponse(res, data);
    } catch (err) { next(err); }
  }

  async getHRFoldersByStatus(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const data = await reportService.getHRFoldersByStatus(req.tenantId);
      return successResponse(res, data);
    } catch (err) { next(err); }
  }

  async getRetentionSummary(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const data = await reportService.getRetentionSummary(req.tenantId);
      return successResponse(res, data);
    } catch (err) { next(err); }
  }

  async getAuditActivity(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const days = parseInt(req.query.days as string) || 30;
      const data = await reportService.getAuditActivity(req.tenantId, days);
      return successResponse(res, data);
    } catch (err) { next(err); }
  }

  async getSlaPerformance(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const data = await reportService.getSlaPerformance(req.tenantId);
      return successResponse(res, data);
    } catch (err) { next(err); }
  }
}

export const reportController = new ReportController();
