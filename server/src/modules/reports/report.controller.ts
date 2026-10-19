import { Request, Response, NextFunction } from 'express';
import { reportService } from './report.service';
import { successResponse, errorResponse } from '../../utils/response';
import { Permissions, RoleCode } from '@archivecore/shared';
import { buildMonthlyReportPdf, getMonthlyReport, parseReportMonth } from './monthly-report.service';
import { buildSlaBreakdownExport, buildSlaTenantTrendExport } from './sla-breakdown-export';
import { prisma } from '../../config/database';
import { OrderType } from '@prisma/client';
import { buildAccessionLedgerCsv, getAccessionLedger, getAccessionLedgerExport, parseLedgerOptions } from './accession-ledger.service';
import { buildAnnualReportPdf, getAnnualReport, parseReportYear } from './annual-report.service';

type SlaReportOptions =
  | { ok: true; scope: 'all' | 'tenant'; tenantId: string | undefined; days: number; orderType: OrderType | undefined }
  | { ok: false; error: string; status: number };

function parseSlaReportOptions(req: Request): SlaReportOptions {
  const scope: 'all' | 'tenant' = req.query.scope === 'all' ? 'all' : 'tenant';
  const canViewAll = req.user?.roles.some((role) => role === RoleCode.SUPER_ADMIN || role === RoleCode.DOXART_ADMIN);
  if (scope === 'all' && !canViewAll) return { ok: false, error: 'Brak uprawnień do raportu wszystkich tenantów', status: 403 };
  if (scope === 'tenant' && !req.tenantId) return { ok: false, error: 'Brak kontekstu tenanta', status: 400 };
  const days = req.query.days === undefined ? 180 : Number(req.query.days);
  if (![30, 90, 180, 365].includes(days)) return { ok: false, error: 'Nieprawidłowy zakres raportu SLA', status: 400 };
  const requestedType = req.query.orderType;
  if (requestedType !== undefined && (typeof requestedType !== 'string' || !Object.values(OrderType).includes(requestedType as OrderType))) {
    return { ok: false, error: 'Nieprawidłowy rodzaj zlecenia', status: 400 };
  }
  return { ok: true, scope, tenantId: scope === 'all' ? undefined : req.tenantId!, days, orderType: requestedType as OrderType | undefined };
}

export class ReportController {
  async getAnnual(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const year = parseReportYear(req.query.year);
      if (year === null) return errorResponse(res, 'Nieprawidłowy rok sprawozdania', 400);
      return successResponse(res, await getAnnualReport(req.tenantId, year));
    } catch (err) { next(err); }
  }

  async getAnnualPdf(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const year = parseReportYear(req.query.year);
      if (year === null) return errorResponse(res, 'Nieprawidłowy rok sprawozdania', 400);
      const report = await getAnnualReport(req.tenantId, year);
      const pdf = await buildAnnualReportPdf(report);
      await prisma.auditLog.create({ data: {
        tenantId: req.tenantId, userId: req.user!.userId,
        action: 'report.annual.export', entityType: 'report',
        newValues: { year }, ipAddress: req.ip,
        userAgent: req.headers['user-agent']?.substring(0, 500),
      } });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="archivecore-sprawozdanie-roczne-${year}.pdf"`);
      res.setHeader('Content-Length', pdf.length);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(pdf);
    } catch (err) { next(err); }
  }

  async getAccessionLedger(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const options = parseLedgerOptions(req.query);
      return successResponse(res, await getAccessionLedger(req.tenantId, options));
    } catch (err) { next(err); }
  }

  async exportAccessionLedger(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const options = parseLedgerOptions(req.query);
      const rows = await getAccessionLedgerExport(req.tenantId, options);
      const buffer = buildAccessionLedgerCsv(rows);
      await prisma.auditLog.create({ data: {
        tenantId: req.tenantId, userId: req.user!.userId,
        action: 'report.accession_ledger.export', entityType: 'report',
        newValues: { year: options.year, kind: options.kind, rows: rows.length },
        ipAddress: req.ip, userAgent: req.headers['user-agent']?.substring(0, 500),
      } });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ksiega-nabytkow-ubytkow-${options.year}.csv"`);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(buffer);
    } catch (err) { next(err); }
  }

  async getMonthlyPdf(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const period = parseReportMonth(req.query.month);
      if (!period) return errorResponse(res, 'Nieprawidłowy miesiąc raportu', 400);
      const includeBilling = Boolean(req.user?.permissions.includes(Permissions.BILLING_VIEW));
      const report = await getMonthlyReport(req.tenantId, period.month, includeBilling);
      const pdf = await buildMonthlyReportPdf(report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="archivecore-raport-${period.month}.pdf"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(pdf);
    } catch (err) { next(err); }
  }

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

  async getStorageHealth(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const data = await reportService.getStorageHealth(req.tenantId);
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

  async getSlaBreakdown(req: Request, res: Response, next: NextFunction) {
    try {
      const options = parseSlaReportOptions(req);
      if (!options.ok) return errorResponse(res, options.error, options.status);
      return successResponse(res, await reportService.getSlaBreakdown(options.tenantId, options.days, new Date(), options.orderType));
    } catch (err) { next(err); }
  }

  async getSlaTrend(req: Request, res: Response, next: NextFunction) {
    try {
      const options = parseSlaReportOptions(req);
      if (!options.ok) return errorResponse(res, options.error, options.status);
      return successResponse(res, await reportService.getSlaTrend(options.tenantId, options.days, new Date(), options.orderType));
    } catch (err) { next(err); }
  }

  async getSlaTenantTrends(req: Request, res: Response, next: NextFunction) {
    try {
      const options = parseSlaReportOptions(req);
      if (!options.ok) return errorResponse(res, options.error, options.status);
      if (options.scope !== 'all') return errorResponse(res, 'Wybierz zakres wszystkich klientów', 400);
      return successResponse(res, await reportService.getSlaTenantTrends(options.days, new Date(), options.orderType));
    } catch (err) { next(err); }
  }

  async exportSlaBreakdown(req: Request, res: Response, next: NextFunction) {
    try {
      const options = parseSlaReportOptions(req);
      if (!options.ok) return errorResponse(res, options.error, options.status);
      const format = req.query.format === undefined ? 'xlsx' : req.query.format;
      if (format !== 'xlsx' && format !== 'csv') return errorResponse(res, 'Nieprawidłowy format eksportu', 400);
      const report = await reportService.getSlaBreakdown(options.tenantId, options.days, new Date(), options.orderType);
      const { buffer, filename, contentType } = buildSlaBreakdownExport(report, options.scope, format);
      await prisma.auditLog.create({
        data: {
          tenantId: options.tenantId,
          userId: req.user!.userId,
          action: 'report.sla.export',
          entityType: 'report',
          newValues: { scope: options.scope, days: options.days, orderType: options.orderType ?? 'all', format, rows: report.data.length, asOf: report.asOf.toISOString() },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']?.substring(0, 500),
        },
      });
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(buffer);
    } catch (err) { next(err); }
  }

  async exportSlaTenantTrends(req: Request, res: Response, next: NextFunction) {
    try {
      const options = parseSlaReportOptions(req);
      if (!options.ok) return errorResponse(res, options.error, options.status);
      if (options.scope !== 'all') return errorResponse(res, 'Wybierz zakres wszystkich klientów', 400);
      const format = req.query.format === undefined ? 'xlsx' : req.query.format;
      if (format !== 'xlsx' && format !== 'csv') return errorResponse(res, 'Nieprawidłowy format eksportu', 400);
      const report = await reportService.getSlaTenantTrends(options.days, new Date(), options.orderType);
      const { buffer, filename, contentType } = buildSlaTenantTrendExport(report, format);
      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'report.sla.tenant_trend.export',
          entityType: 'report',
          newValues: { scope: 'all', days: options.days, orderType: options.orderType ?? 'all', format, tenants: report.data.length, asOf: report.asOf.toISOString() },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']?.substring(0, 500),
        },
      });
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(buffer);
    } catch (err) { next(err); }
  }
}

export const reportController = new ReportController();
