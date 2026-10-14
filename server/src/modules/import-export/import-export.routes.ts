import { Router } from 'express';
import { exportController } from './export.controller';
import { importController } from './import.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { auditLog } from '../../middleware/audit';
import { fileUpload } from '../../middleware/upload';
import { Permissions } from '@archivecore/shared';
import multer from 'multer';

const router = Router();
const auth = [authenticate, tenantContext];
const scanUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff', 'application/octet-stream'].includes(file.mimetype));
  },
});
const uploadScan = (req: Parameters<ReturnType<typeof scanUpload.single>>[0], res: Parameters<ReturnType<typeof scanUpload.single>>[1], next: Parameters<ReturnType<typeof scanUpload.single>>[2]) => {
  scanUpload.single('file')(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(Object.assign(new Error('Skan nie może przekraczać 10 MB'), { statusCode: 413 }));
    }
    next(error);
  });
};

// ─── Export endpoints ────────────────────────────────────
router.get('/export/boxes', ...auth, requirePermission(Permissions.EXPORT_DATA), auditLog('export', 'export.boxes'), (req, res, next) => exportController.exportBoxes(req, res, next));
router.get('/export/orders', ...auth, requirePermission(Permissions.EXPORT_DATA), auditLog('export', 'export.orders'), (req, res, next) => exportController.exportOrders(req, res, next));
router.get('/export/hr', ...auth, requirePermission(Permissions.EXPORT_DATA), auditLog('export', 'export.hr'), (req, res, next) => exportController.exportHR(req, res, next));
router.get('/export/transfer-lists', ...auth, requirePermission(Permissions.EXPORT_DATA), auditLog('export', 'export.transfer-lists'), (req, res, next) => exportController.exportTransferLists(req, res, next));

// ─── Import endpoints (preview + execute) ────────────────
router.post('/import/boxes/inspect', ...auth, requirePermission(Permissions.IMPORT_DATA), fileUpload.single('file'), (req, res, next) => importController.inspectBoxes(req, res, next));
router.post('/import/boxes/preview', ...auth, requirePermission(Permissions.IMPORT_DATA), fileUpload.single('file'), (req, res, next) => importController.previewBoxes(req, res, next));
router.post('/import/boxes', ...auth, requirePermission(Permissions.IMPORT_DATA), fileUpload.single('file'), auditLog('import', 'import.boxes'), (req, res, next) => importController.importBoxes(req, res, next));
router.post('/import/hr/inspect', ...auth, requirePermission(Permissions.IMPORT_DATA), fileUpload.single('file'), (req, res, next) => importController.inspectHR(req, res, next));
router.post('/import/hr/preview', ...auth, requirePermission(Permissions.IMPORT_DATA), fileUpload.single('file'), (req, res, next) => importController.previewHR(req, res, next));
router.post('/import/hr', ...auth, requirePermission(Permissions.IMPORT_DATA), fileUpload.single('file'), auditLog('import', 'import.hr'), (req, res, next) => importController.importHR(req, res, next));
router.post('/import/transfer-lists/preview', ...auth, requirePermission(Permissions.IMPORT_DATA), fileUpload.single('file'), (req, res, next) => importController.previewTransferLists(req, res, next));
router.post('/import/transfer-lists/scan/recognize', ...auth, requirePermission(Permissions.IMPORT_DATA), uploadScan, (req, res, next) => importController.recognizeTransferListScan(req, res, next));
router.post('/import/transfer-lists/scan', ...auth, requirePermission(Permissions.IMPORT_DATA), auditLog('import', 'import.transfer-lists.scan'), (req, res, next) => importController.importReviewedScan(req, res, next));
router.post('/import/transfer-lists/inspect', ...auth, requirePermission(Permissions.IMPORT_DATA), fileUpload.single('file'), (req, res, next) => importController.inspectTransferLists(req, res, next));
router.post('/import/transfer-lists', ...auth, requirePermission(Permissions.IMPORT_DATA), fileUpload.single('file'), auditLog('import', 'import.transfer-lists'), (req, res, next) => importController.importTransferLists(req, res, next));

export default router;
