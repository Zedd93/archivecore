import { Request, Response, NextFunction } from 'express';
import { orderService } from './order.service';
import { custodyService } from './custody.service';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';
import { orderScanService } from './order-scan.service';
import { billingService } from '../pricing/billing.service';
import { orderHandoverPhotoService } from './order-handover-photo.service';
import { z } from 'zod';
import { OrderPriority, OrderType } from '@prisma/client';
import { loanReturnRequestService } from './loan-return-request.service';

export class OrderController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { skip, take, page, limit } = parsePagination(req.query as any);
      const { data, total } = await orderService.list(req.tenantId, req.query, skip, take, req.accessDepartment || undefined);
      return paginatedResponse(res, data, total, page, limit);
    } catch (err) { next(err); }
  }

  async listWarehouseTasks(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { data, total } = await orderService.listWarehouseTasks(req.tenantId, req.accessDepartment || undefined);
      return paginatedResponse(res, data, total, 1, 12);
    } catch (err) { next(err); }
  }

  async getSlaSummary(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const summary = await orderService.getSlaSummary(req.tenantId, req.accessDepartment || undefined);
      return successResponse(res, summary);
    } catch (err) { next(err); }
  }

  async previewSla(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const preview = await orderService.previewSla(req.tenantId, req.query.orderType as OrderType, req.query.priority as OrderPriority);
      res.setHeader('Cache-Control', 'private, no-store');
      return successResponse(res, preview);
    } catch (err) { next(err); }
  }

  async previewScanRate(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      res.setHeader('Cache-Control', 'private, no-store');
      return successResponse(res, await billingService.previewScanRate(req.tenantId));
    } catch (err) { next(err); }
  }

  async getScanBilling(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!z.string().uuid().safeParse(req.params.id).success) return errorResponse(res, 'Nieprawidłowy identyfikator zlecenia', 400);
      res.setHeader('Cache-Control', 'private, no-store');
      return successResponse(res, await orderService.getScanBilling(req.params.id, req.tenantId, req.accessDepartment || undefined));
    } catch (err) { next(err); }
  }

  async getScanQuote(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!z.string().uuid().safeParse(req.params.id).success) return errorResponse(res, 'Nieprawidłowy identyfikator zlecenia', 400);
      res.setHeader('Cache-Control', 'private, no-store');
      return successResponse(res, await orderService.getScanQuote(req.params.id, req.tenantId, req.accessDepartment || undefined));
    } catch (err) { next(err); }
  }

  async prepareScanQuote(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!z.string().uuid().safeParse(req.params.id).success) return errorResponse(res, 'Nieprawidłowy identyfikator zlecenia', 400);
      return successResponse(res, await orderService.prepareExistingScanQuote(req.params.id, req.tenantId, req.user!.userId), 201);
    } catch (err) { next(err); }
  }

  async approveScanQuote(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!z.string().uuid().safeParse(req.params.id).success) return errorResponse(res, 'Nieprawidłowy identyfikator zlecenia', 400);
      if (req.user!.tenantId !== req.tenantId) return errorResponse(res, 'Wycena może być zatwierdzona wyłącznie przez użytkownika tego klienta', 403);
      return successResponse(res, await orderService.approveScanQuote(req.params.id, req.tenantId, req.user!.userId));
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.getById(req.params.id, req.tenantId, req.accessDepartment || undefined);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async getHistory(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!z.string().uuid().safeParse(req.params.id).success) return errorResponse(res, 'Nieprawidłowy identyfikator zlecenia', 400);
      const { skip, take, page, limit } = parsePagination(req.query as any);
      const { data, total } = await orderService.getHistory(req.params.id, req.tenantId, skip, take, req.accessDepartment || undefined);
      return paginatedResponse(res, data, total, page, limit);
    } catch (err) { next(err); }
  }

  async uploadScan(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!z.string().uuid().safeParse(req.params.id).success || !z.string().uuid().safeParse(req.params.itemId).success) {
        return errorResponse(res, 'Nieprawidłowy identyfikator pozycji', 400);
      }
      if (!req.file) return errorResponse(res, 'Dołącz skan w formacie PDF do 25 MB', 400);
      return successResponse(res, await orderScanService.upload(req.params.id, req.params.itemId, req.tenantId, req.user!.userId, req.file, req.accessDepartment || undefined), 201);
    } catch (err) { next(err); }
  }

  async attachExistingScan(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (![req.params.id, req.params.itemId, req.body?.attachmentId].every((id) => z.string().uuid().safeParse(id).success)) {
        return errorResponse(res, 'Nieprawidłowy identyfikator zlecenia, pozycji lub skanu', 400);
      }
      return successResponse(res, await orderScanService.attachExisting(
        req.params.id, req.params.itemId, req.tenantId, req.user!.userId, req.body.attachmentId, req.accessDepartment || undefined,
      ), 201);
    } catch (err) { next(err); }
  }

  async downloadScan(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!z.string().uuid().safeParse(req.params.id).success || !z.string().uuid().safeParse(req.params.itemId).success) {
        return errorResponse(res, 'Nieprawidłowy identyfikator pozycji', 400);
      }
      const scan = await orderScanService.download(req.params.id, req.params.itemId, req.tenantId, req.accessDepartment || undefined);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="archivecore-skan-${req.params.itemId}.pdf"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(scan.buffer);
    } catch (err) { next(err); }
  }

  async listHandoverPhotos(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!z.string().uuid().safeParse(req.params.id).success) return errorResponse(res, 'Nieprawidłowy identyfikator zlecenia', 400);
      await orderService.getById(req.params.id, req.tenantId, req.accessDepartment || undefined);
      return successResponse(res, await orderHandoverPhotoService.list(req.tenantId, req.params.id));
    } catch (err) { next(err); }
  }

  async uploadHandoverPhoto(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!z.string().uuid().safeParse(req.params.id).success) return errorResponse(res, 'Nieprawidłowy identyfikator zlecenia', 400);
      const boxId = typeof req.body?.boxId === 'string' && req.body.boxId ? req.body.boxId : undefined;
      if (boxId && !z.string().uuid().safeParse(boxId).success) return errorResponse(res, 'Nieprawidłowy identyfikator kartonu', 400);
      if (!req.file) return errorResponse(res, 'Dołącz zdjęcie JPEG lub PNG do 5 MB', 400);
      await orderService.getById(req.params.id, req.tenantId, req.accessDepartment || undefined);
      return successResponse(res, await orderHandoverPhotoService.upload(req.tenantId, req.params.id, req.user!.userId, req.file, boxId), 201);
    } catch (err) { next(err); }
  }

  async downloadHandoverPhoto(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!z.string().uuid().safeParse(req.params.id).success || !z.string().uuid().safeParse(req.params.photoId).success) {
        return errorResponse(res, 'Nieprawidłowy identyfikator zdjęcia', 400);
      }
      await orderService.getById(req.params.id, req.tenantId, req.accessDepartment || undefined);
      const photo = await orderHandoverPhotoService.download(req.tenantId, req.params.id, req.params.photoId);
      res.setHeader('Content-Type', photo.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="archivecore-przekazanie-${req.params.photoId}.${photo.mimeType === 'image/png' ? 'png' : 'jpg'}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(photo.buffer);
    } catch (err) { next(err); }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const result = await orderService.delete(req.params.id, req.tenantId);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.create(req.body, req.tenantId, req.user!.userId, req.accessDepartment || undefined);
      return successResponse(res, order, 201);
    } catch (err) { next(err); }
  }

  async addItem(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const item = await orderService.addItem(req.params.id, req.tenantId, req.body, req.user!.userId, req.accessDepartment || undefined);
      return successResponse(res, item, 201);
    } catch (err) { next(err); }
  }

  async submit(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.submit(req.params.id, req.tenantId, req.user!.userId, req.accessDepartment || undefined);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async approve(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.approve(req.params.id, req.tenantId, req.user!.userId, req.accessDepartment || undefined);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async reject(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.reject(req.params.id, req.tenantId, req.user!.userId, req.body.notes, req.accessDepartment || undefined);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async startProcessing(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.startProcessing(req.params.id, req.tenantId, req.user!.userId, req.accessDepartment || undefined);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async markReady(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.markReady(req.params.id, req.tenantId, req.user!.userId);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async deliver(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.deliver(req.params.id, req.tenantId, req.user!.userId, req.body.proof);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async complete(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.complete(req.params.id, req.tenantId, req.user!.userId);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.cancel(req.params.id, req.tenantId, req.user!.userId, req.body.notes, req.accessDepartment || undefined);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async assign(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.assign(req.params.id, req.tenantId, req.body.assigneeId, req.user!.userId, req.accessDepartment || undefined);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async listAssignees(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      return successResponse(res, await orderService.listAssignees(req.tenantId));
    } catch (err) { next(err); }
  }

  async updateItemStatus(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const item = await orderService.updateItemStatus(
        req.params.id, req.params.itemId, req.tenantId, req.body.status, req.user!.userId
      );
      return successResponse(res, item);
    } catch (err) { next(err); }
  }

  async returnLoanItem(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.returnLoanItem(req.params.id, req.params.itemId, req.tenantId, req.user!.userId);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async getOverdueSla(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const orders = await orderService.getOverdueSla(req.tenantId, req.accessDepartment || undefined);
      return successResponse(res, orders);
    } catch (err) { next(err); }
  }

  async getActiveLoans(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const loans = await orderService.getActiveLoans(req.tenantId, req.accessDepartment || undefined);
      return successResponse(res, loans);
    } catch (err) { next(err); }
  }

  async requestLoanReturn(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      res.setHeader('Cache-Control', 'private, no-store');
      return successResponse(res, await loanReturnRequestService.request(
        req.params.id, req.params.itemId, req.tenantId, req.user!.userId, req.accessDepartment || undefined,
      ));
    } catch (err) { next(err); }
  }

  async createCustodyEvent(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const event = await custodyService.create({
        ...req.body,
        orderId: req.params.id,
        fromUserId: req.user!.userId,
      }, req.tenantId);
      return successResponse(res, event, 201);
    } catch (err) { next(err); }
  }

  async getCustodyByOrder(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      await orderService.getById(req.params.id, req.tenantId, req.accessDepartment || undefined);
      const events = await custodyService.getByOrder(req.params.id, req.tenantId, req.accessDepartment || undefined);
      return successResponse(res, events);
    } catch (err) { next(err); }
  }
}

export const orderController = new OrderController();
