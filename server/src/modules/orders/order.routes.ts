import { Router } from 'express';
import { orderController } from './order.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/audit';
import { Permissions, createOrderSchema, createCustodyEventSchema, rejectOrderSchema, cancelOrderSchema, assignOrderSchema, updateOrderItemStatusSchema } from '@archivecore/shared';

const router = Router();
const auth = [authenticate, tenantContext];

// List & read
router.get('/', ...auth, requirePermission(Permissions.ORDER_READ), (req, res, next) => orderController.list(req, res, next));
router.get('/overdue-sla', ...auth, requirePermission(Permissions.ORDER_READ), (req, res, next) => orderController.getOverdueSla(req, res, next));
router.get('/:id', ...auth, requirePermission(Permissions.ORDER_READ), (req, res, next) => orderController.getById(req, res, next));
router.get('/:id/custody', ...auth, requirePermission(Permissions.ORDER_READ), (req, res, next) => orderController.getCustodyByOrder(req, res, next));

// Create
router.post('/', ...auth, requirePermission(Permissions.ORDER_CREATE), validate(createOrderSchema), auditLog('order', 'order.create'), (req, res, next) => orderController.create(req, res, next));

// Status transitions
router.patch('/:id/submit', ...auth, requirePermission(Permissions.ORDER_CREATE), auditLog('order', 'order.submit'), (req, res, next) => orderController.submit(req, res, next));
router.patch('/:id/approve', ...auth, requirePermission(Permissions.ORDER_APPROVE), auditLog('order', 'order.approve'), (req, res, next) => orderController.approve(req, res, next));
router.patch('/:id/reject', ...auth, requirePermission(Permissions.ORDER_APPROVE), validate(rejectOrderSchema), auditLog('order', 'order.reject'), (req, res, next) => orderController.reject(req, res, next));
router.patch('/:id/process', ...auth, requirePermission(Permissions.ORDER_PROCESS), auditLog('order', 'order.process'), (req, res, next) => orderController.startProcessing(req, res, next));
router.patch('/:id/ready', ...auth, requirePermission(Permissions.ORDER_PROCESS), auditLog('order', 'order.ready'), (req, res, next) => orderController.markReady(req, res, next));
router.patch('/:id/deliver', ...auth, requirePermission(Permissions.ORDER_PROCESS), auditLog('order', 'order.deliver'), (req, res, next) => orderController.deliver(req, res, next));
router.patch('/:id/complete', ...auth, requirePermission(Permissions.ORDER_COMPLETE), auditLog('order', 'order.complete'), (req, res, next) => orderController.complete(req, res, next));
router.patch('/:id/cancel', ...auth, requirePermission(Permissions.ORDER_CREATE), validate(cancelOrderSchema), auditLog('order', 'order.cancel'), (req, res, next) => orderController.cancel(req, res, next));

// Assignment
router.patch('/:id/assign', ...auth, requirePermission(Permissions.ORDER_PROCESS), validate(assignOrderSchema), auditLog('order', 'order.assign'), (req, res, next) => orderController.assign(req, res, next));

// Item status
router.patch('/:id/items/:itemId/status', ...auth, requirePermission(Permissions.ORDER_PROCESS), validate(updateOrderItemStatusSchema), auditLog('order_item', 'order_item.status'), (req, res, next) => orderController.updateItemStatus(req, res, next));

// Custody events
router.post('/:id/custody', ...auth, requirePermission(Permissions.ORDER_PROCESS), validate(createCustodyEventSchema), auditLog('custody_event', 'custody.create'), (req, res, next) => orderController.createCustodyEvent(req, res, next));

export default router;
