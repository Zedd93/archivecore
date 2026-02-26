import { Router } from 'express';
import { exportController } from './export.controller';
import { importController } from './import.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { auditLog } from '../../middleware/audit';
import { fileUpload } from '../../middleware/upload';
import { Permissions } from '@archivecore/shared';

const router = Router();
const auth = [authenticate, tenantContext];

// ─── Export endpoints ────────────────────────────────────
router.get('/export/boxes', ...auth, requirePermission(Permissions.EXPORT_DATA), auditLog('export', 'export.boxes'), (req, res, next) => exportController.exportBoxes(req, res, next));
router.get('/export/orders', ...auth, requirePermission(Permissions.EXPORT_DATA), auditLog('export', 'export.orders'), (req, res, next) => exportController.exportOrders(req, res, next));
router.get('/export/hr', ...auth, requirePermission(Permissions.EXPORT_DATA), auditLog('export', 'export.hr'), (req, res, next) => exportController.exportHR(req, res, next));
router.get('/export/transfer-lists', ...auth, requirePermission(Permissions.EXPORT_DATA), auditLog('export', 'export.transfer-lists'), (req, res, next) => exportController.exportTransferLists(req, res, next));

// ─── Import endpoints (preview + execute) ────────────────
router.post('/import/boxes/preview', ...auth, requirePermission(Permissions.IMPORT_DATA), fileUpload.single('file'), (req, res, next) => importController.previewBoxes(req, res, next));
router.post('/import/boxes', ...auth, requirePermission(Permissions.IMPORT_DATA), fileUpload.single('file'), auditLog('import', 'import.boxes'), (req, res, next) => importController.importBoxes(req, res, next));
router.post('/import/hr/preview', ...auth, requirePermission(Permissions.IMPORT_DATA), fileUpload.single('file'), (req, res, next) => importController.previewHR(req, res, next));
router.post('/import/hr', ...auth, requirePermission(Permissions.IMPORT_DATA), fileUpload.single('file'), auditLog('import', 'import.hr'), (req, res, next) => importController.importHR(req, res, next));

export default router;
