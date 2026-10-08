import { NextFunction, Request, Response } from 'express';
import { successResponse } from '../../utils/response';
import { pricingService } from './pricing.service';
import { billingService } from './billing.service';
import { parsePagination } from '../../utils/pagination';
import { billingExportService } from './billing-export.service';
import { billingInvoiceService } from './billing-invoice.service';
import { prisma } from '../../config/database';

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

  async listBillingEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const { skip, take, page, limit } = parsePagination(req.query as any);
      const result = await billingService.listForTenant(req.params.tenantId, req.query, skip, take);
      return successResponse(res, {
        ...result,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit),
        },
      });
    } catch (err) { next(err); }
  }

  async excludeBillingEvent(req: Request, res: Response, next: NextFunction) {
    try {
      return successResponse(res, await billingService.exclude(req.params.id, req.body.reason));
    } catch (err) { next(err); }
  }

  async restoreBillingEvent(req: Request, res: Response, next: NextFunction) {
    try {
      return successResponse(res, await billingService.restore(req.params.id));
    } catch (err) { next(err); }
  }

  async generateMonthlyStorage(req: Request, res: Response, next: NextFunction) {
    try {
      return successResponse(
        res,
        await billingService.generateMonthlyStorage(req.params.tenantId, req.body.month)
      );
    } catch (err) { next(err); }
  }

  async closeBillingPeriod(req: Request, res: Response, next: NextFunction) {
    try {
      return successResponse(
        res,
        await billingService.closePeriod(req.params.tenantId, req.body.month, req.user!.userId)
      );
    } catch (err) { next(err); }
  }

  async confirmBillingInvoice(req: Request, res: Response, next: NextFunction) {
    try {
      return successResponse(
        res,
        await billingInvoiceService.confirmInvoice(req.params.tenantId, req.body.month, req.body.invoiceNumber, req.user!.userId)
      );
    } catch (err) { next(err); }
  }

  async exportBillingPeriod(req: Request, res: Response, next: NextFunction) {
    try {
      const month = req.query.month as string;
      const { buffer, filename, periodId, eventCount } = await billingExportService.exportClosedPeriod(req.params.tenantId, month);
      await prisma.auditLog.create({
        data: {
          tenantId: req.params.tenantId,
          userId: req.user!.userId,
          action: 'billing.period.export',
          entityType: 'billing_period',
          entityId: periodId,
          newValues: { month, eventCount },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']?.substring(0, 500),
        },
      });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) { next(err); }
  }
}

export const pricingController = new PricingController();
