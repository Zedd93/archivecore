import { Router, Request, Response, NextFunction } from 'express';
import { RoleCode } from '@archivecore/shared';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { notificationController } from './notification.controller';
import { EMAIL_DELIVERY_STATUSES } from './email-delivery.service';

const router = Router();
const emailAdmin = requireRole(RoleCode.SUPER_ADMIN, RoleCode.DOXART_ADMIN);
const globalAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.tenantId !== null) return res.status(403).json({ success: false, error: 'Brak uprawnień do podglądu poczty' });
  next();
};
const emailListQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  status: z.enum(EMAIL_DELIVERY_STATUSES).optional(),
});
const emailIdParams = z.object({ id: z.string().uuid() });

router.get('/', authenticate, (req, res, next) => notificationController.list(req, res, next));
router.get('/email-deliveries', authenticate, emailAdmin, globalAdmin, validate(emailListQuery, 'query'), (req, res, next) => notificationController.listEmailDeliveries(req, res, next));
router.post('/email-deliveries/:id/retry', authenticate, emailAdmin, globalAdmin, validate(emailIdParams, 'params'), (req, res, next) => notificationController.retryEmailDelivery(req, res, next));
router.patch('/:id/read', authenticate, (req, res, next) => notificationController.markRead(req, res, next));
router.post('/read-all', authenticate, (req, res, next) => notificationController.markAllRead(req, res, next));

export default router;
