import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { notificationController } from './notification.controller';

const router = Router();

router.get('/', authenticate, (req, res, next) => notificationController.list(req, res, next));
router.patch('/:id/read', authenticate, (req, res, next) => notificationController.markRead(req, res, next));
router.post('/read-all', authenticate, (req, res, next) => notificationController.markAllRead(req, res, next));

export default router;
