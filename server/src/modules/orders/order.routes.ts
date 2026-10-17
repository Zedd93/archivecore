import { Router } from 'express';
import { orderController } from './order.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission, requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/audit';
import { Permissions, RoleCode, createOrderSchema, previewOrderSlaQuerySchema, addOrderItemSchema, createCustodyEventSchema, rejectOrderSchema, cancelOrderSchema, assignOrderSchema, updateOrderItemStatusSchema, deliverOrderSchema } from '@archivecore/shared';
import multer from 'multer';
import { z } from 'zod';

const router = Router();
const auth = [authenticate, tenantContext];
const scanUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});
const uploadScanFile = (req: Parameters<ReturnType<typeof scanUpload.single>>[0], res: Parameters<ReturnType<typeof scanUpload.single>>[1], next: Parameters<ReturnType<typeof scanUpload.single>>[2]) => {
  scanUpload.single('file')(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(Object.assign(new Error('Skan PDF nie może przekraczać 25 MB'), { statusCode: 413 }));
    }
    next(error);
  });
};
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const uploadHandoverPhoto = (req: Parameters<ReturnType<typeof photoUpload.single>>[0], res: Parameters<ReturnType<typeof photoUpload.single>>[1], next: Parameters<ReturnType<typeof photoUpload.single>>[2]) => {
  photoUpload.single('file')(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(Object.assign(new Error('Zdjęcie nie może przekraczać 5 MB'), { statusCode: 413 }));
    }
    next(error);
  });
};

// List & read
router.get('/', ...auth, requirePermission(Permissions.ORDER_READ), (req, res, next) => orderController.list(req, res, next));
router.get('/warehouse-tasks', ...auth, requirePermission(Permissions.ORDER_READ), (req, res, next) => orderController.listWarehouseTasks(req, res, next));
router.get('/sla-summary', ...auth, requirePermission(Permissions.ORDER_READ), (req, res, next) => orderController.getSlaSummary(req, res, next));
router.get('/sla-preview', ...auth, requirePermission(Permissions.ORDER_CREATE), validate(previewOrderSlaQuerySchema, 'query'), (req, res, next) => orderController.previewSla(req, res, next));
router.get('/scan-rate', ...auth, requirePermission(Permissions.ORDER_CREATE), requirePermission(Permissions.BILLING_VIEW), (req, res, next) => orderController.previewScanRate(req, res, next));
router.get('/assignees', ...auth, requirePermission(Permissions.ORDER_PROCESS), (req, res, next) => orderController.listAssignees(req, res, next));
router.get('/overdue-sla', ...auth, requirePermission(Permissions.ORDER_READ), (req, res, next) => orderController.getOverdueSla(req, res, next));
router.get('/loans/active', ...auth, requirePermission(Permissions.ORDER_READ), (req, res, next) => orderController.getActiveLoans(req, res, next));
router.post('/:id/items/:itemId/request-return', ...auth, requirePermission(Permissions.ORDER_CREATE), validate(z.object({ id: z.string().uuid(), itemId: z.string().uuid() }), 'params'), (req, res, next) => orderController.requestLoanReturn(req, res, next));
router.get('/:id', ...auth, requirePermission(Permissions.ORDER_READ), (req, res, next) => orderController.getById(req, res, next));
router.get('/:id/scan-billing', ...auth, requirePermission(Permissions.ORDER_READ), requirePermission(Permissions.BILLING_VIEW), (req, res, next) => orderController.getScanBilling(req, res, next));
router.get('/:id/scan-quote', ...auth, requirePermission(Permissions.ORDER_READ), requirePermission(Permissions.BILLING_VIEW), (req, res, next) => orderController.getScanQuote(req, res, next));
router.get('/:id/history', ...auth, requirePermission(Permissions.ORDER_READ), (req, res, next) => orderController.getHistory(req, res, next));
router.get('/:id/items/:itemId/scan', ...auth, requirePermission(Permissions.ORDER_READ), (req, res, next) => orderController.downloadScan(req, res, next));
router.get('/:id/custody', ...auth, requirePermission(Permissions.ORDER_READ), (req, res, next) => orderController.getCustodyByOrder(req, res, next));
router.get('/:id/handover/photos', ...auth, requirePermission(Permissions.ORDER_READ), (req, res, next) => orderController.listHandoverPhotos(req, res, next));
router.get('/:id/handover/photos/:photoId/file', ...auth, requirePermission(Permissions.ORDER_READ), (req, res, next) => orderController.downloadHandoverPhoto(req, res, next));
router.delete('/:id', ...auth, requirePermission(Permissions.ORDER_COMPLETE), requireRole(RoleCode.SUPER_ADMIN, RoleCode.DOXART_ADMIN), auditLog('order', 'order.delete'), (req, res, next) => orderController.delete(req, res, next));

// Create
router.post('/', ...auth, requirePermission(Permissions.ORDER_CREATE), validate(createOrderSchema), auditLog('order', 'order.create'), (req, res, next) => orderController.create(req, res, next));
router.post('/:id/items', ...auth, requirePermission(Permissions.ORDER_CREATE, Permissions.ORDER_PROCESS), validate(addOrderItemSchema), auditLog('order_item', 'order_item.create'), (req, res, next) => orderController.addItem(req, res, next));
router.post('/:id/items/:itemId/scan', ...auth, requirePermission(Permissions.ORDER_PROCESS), uploadScanFile, auditLog('order_scan_file', 'order_scan.upload'), (req, res, next) => orderController.uploadScan(req, res, next));
router.post('/:id/items/:itemId/scan/from-attachment', ...auth, requirePermission(Permissions.ORDER_PROCESS), requirePermission(Permissions.ATTACHMENT_READ), auditLog('order_scan_file', 'order_scan.upload'), (req, res, next) => orderController.attachExistingScan(req, res, next));
router.post('/:id/scan-quote', ...auth, requirePermission(Permissions.ORDER_PROCESS), requirePermission(Permissions.BILLING_VIEW), auditLog('order', 'order.scan_quote.prepare'), (req, res, next) => orderController.prepareScanQuote(req, res, next));
router.post('/:id/handover/photos', ...auth, requirePermission(Permissions.ORDER_PROCESS), uploadHandoverPhoto, auditLog('order_handover_photo', 'order.handover_photo.upload'), (req, res, next) => orderController.uploadHandoverPhoto(req, res, next));

// Status transitions
router.patch('/:id/submit', ...auth, requirePermission(Permissions.ORDER_CREATE), auditLog('order', 'order.submit'), (req, res, next) => orderController.submit(req, res, next));
router.patch('/:id/approve', ...auth, requirePermission(Permissions.ORDER_APPROVE), auditLog('order', 'order.approve'), (req, res, next) => orderController.approve(req, res, next));
router.patch('/:id/reject', ...auth, requirePermission(Permissions.ORDER_APPROVE), validate(rejectOrderSchema), auditLog('order', 'order.reject'), (req, res, next) => orderController.reject(req, res, next));
router.patch('/:id/process', ...auth, requirePermission(Permissions.ORDER_PROCESS), auditLog('order', 'order.process'), (req, res, next) => orderController.startProcessing(req, res, next));
router.patch('/:id/ready', ...auth, requirePermission(Permissions.ORDER_PROCESS), auditLog('order', 'order.ready'), (req, res, next) => orderController.markReady(req, res, next));
router.patch('/:id/scan-quote/approve', ...auth, requirePermission(Permissions.ORDER_APPROVE), requirePermission(Permissions.BILLING_VIEW), requireRole(RoleCode.TENANT_LEADERSHIP, RoleCode.ADMIN_TENANT), auditLog('order', 'order.scan_quote.approve'), (req, res, next) => orderController.approveScanQuote(req, res, next));
router.patch('/:id/deliver', ...auth, requirePermission(Permissions.ORDER_PROCESS), validate(deliverOrderSchema), auditLog('order', 'order.deliver'), (req, res, next) => orderController.deliver(req, res, next));
router.patch('/:id/complete', ...auth, requirePermission(Permissions.ORDER_COMPLETE), auditLog('order', 'order.complete'), (req, res, next) => orderController.complete(req, res, next));
router.patch('/:id/cancel', ...auth, requirePermission(Permissions.ORDER_CREATE), validate(cancelOrderSchema), auditLog('order', 'order.cancel'), (req, res, next) => orderController.cancel(req, res, next));

// Assignment
router.patch('/:id/assign', ...auth, requirePermission(Permissions.ORDER_PROCESS), validate(assignOrderSchema), auditLog('order', 'order.assign'), (req, res, next) => orderController.assign(req, res, next));

// Item status
router.patch('/:id/items/:itemId/status', ...auth, requirePermission(Permissions.ORDER_PROCESS), validate(updateOrderItemStatusSchema), auditLog('order_item', 'order_item.status'), (req, res, next) => orderController.updateItemStatus(req, res, next));
router.patch('/:id/items/:itemId/return', ...auth, requirePermission(Permissions.ORDER_COMPLETE), auditLog('order_item', 'order_item.return'), (req, res, next) => orderController.returnLoanItem(req, res, next));

// Custody events
router.post('/:id/custody', ...auth, requirePermission(Permissions.ORDER_PROCESS), validate(createCustodyEventSchema), auditLog('custody_event', 'custody.create'), (req, res, next) => orderController.createCustodyEvent(req, res, next));

export default router;
