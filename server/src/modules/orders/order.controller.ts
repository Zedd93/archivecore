import { Request, Response, NextFunction } from 'express';
import { orderService } from './order.service';
import { custodyService } from './custody.service';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';

export class OrderController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { skip, take, page, limit } = parsePagination(req.query as any);
      const { data, total } = await orderService.list(req.tenantId, req.query, skip, take);
      return paginatedResponse(res, data, total, page, limit);
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.getById(req.params.id, req.tenantId);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.create(req.body, req.tenantId, req.user!.userId);
      return successResponse(res, order, 201);
    } catch (err) { next(err); }
  }

  async submit(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.submit(req.params.id, req.tenantId, req.user!.userId);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async approve(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.approve(req.params.id, req.tenantId, req.user!.userId);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async reject(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.reject(req.params.id, req.tenantId, req.user!.userId, req.body.notes);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async startProcessing(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.startProcessing(req.params.id, req.tenantId, req.user!.userId);
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
      const order = await orderService.deliver(req.params.id, req.tenantId, req.user!.userId);
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
      const order = await orderService.cancel(req.params.id, req.tenantId, req.user!.userId, req.body.notes);
      return successResponse(res, order);
    } catch (err) { next(err); }
  }

  async assign(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const order = await orderService.assign(req.params.id, req.tenantId, req.body.assigneeId);
      return successResponse(res, order);
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

  async getOverdueSla(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const orders = await orderService.getOverdueSla(req.tenantId);
      return successResponse(res, orders);
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
      const events = await custodyService.getByOrder(req.params.id, req.tenantId);
      return successResponse(res, events);
    } catch (err) { next(err); }
  }
}

export const orderController = new OrderController();
