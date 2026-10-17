import { Request, Response, NextFunction } from 'express';
import { notificationService } from './notification.service';
import { successResponse } from '../../utils/response';
import { emailDeliveryService, EmailDeliveryStatus } from './email-delivery.service';

export class NotificationController {
  async listEmailDeliveries(req: Request, res: Response, next: NextFunction) {
    try {
      res.setHeader('Cache-Control', 'no-store');
      return successResponse(res, await emailDeliveryService.listAdmin(
        Number(req.query.page), req.query.status as EmailDeliveryStatus | undefined,
      ));
    } catch (err) { next(err); }
  }

  async retryEmailDelivery(req: Request, res: Response, next: NextFunction) {
    try {
      res.setHeader('Cache-Control', 'no-store');
      return successResponse(res, await emailDeliveryService.retryFailed(req.params.id, req.user!.userId));
    } catch (err) { next(err); }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      const data = await notificationService.list(req.user!.userId, Number.isFinite(limit) ? limit : 20);
      return successResponse(res, data);
    } catch (err) { next(err); }
  }

  async markRead(req: Request, res: Response, next: NextFunction) {
    try {
      await notificationService.markRead(req.params.id, req.user!.userId);
      return successResponse(res, { read: true });
    } catch (err) { next(err); }
  }

  async markAllRead(req: Request, res: Response, next: NextFunction) {
    try {
      await notificationService.markAllRead(req.user!.userId);
      return successResponse(res, { read: true });
    } catch (err) { next(err); }
  }
}

export const notificationController = new NotificationController();
