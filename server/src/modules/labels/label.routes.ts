import { Router } from 'express';
import { labelController } from './label.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { auditLog } from '../../middleware/audit';
import { Permissions } from '@archivecore/shared';

const router = Router();
const auth = [authenticate, tenantContext];

// Templates
router.get('/templates', ...auth, requirePermission(Permissions.LABEL_READ), (req, res, next) => labelController.getTemplates(req, res, next));
router.post('/templates', ...auth, requirePermission(Permissions.LABEL_TEMPLATE_MANAGE), auditLog('label_template', 'template.create'), (req, res, next) => labelController.createTemplate(req, res, next));

// Generate labels (PDF)
router.get('/box/:boxId', ...auth, requirePermission(Permissions.LABEL_GENERATE), (req, res, next) => labelController.generateForBox(req, res, next));
router.post('/batch', ...auth, requirePermission(Permissions.LABEL_GENERATE), auditLog('label', 'label.batch_generate'), (req, res, next) => labelController.generateForBoxes(req, res, next));

// QR code image
router.get('/qr/:boxId', ...auth, requirePermission(Permissions.LABEL_READ), (req, res, next) => labelController.getQrCode(req, res, next));

export default router;
