import { Router } from 'express';
import { attachmentController } from './attachment.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { auditLog } from '../../middleware/audit';
import { fileUpload } from '../../middleware/upload';
import { Permissions } from '@archivecore/shared';

const router = Router();
const auth = [authenticate, tenantContext];

router.get('/', ...auth, requirePermission(Permissions.ATTACHMENT_READ), (req, res, next) => attachmentController.list(req, res, next));
router.get('/:id/download', ...auth, requirePermission(Permissions.ATTACHMENT_READ), (req, res, next) => attachmentController.getDownloadUrl(req, res, next));
router.post('/', ...auth, requirePermission(Permissions.ATTACHMENT_UPLOAD), fileUpload.single('file'), auditLog('attachment', 'attachment.upload'), (req, res, next) => attachmentController.upload(req, res, next));
router.delete('/:id', ...auth, requirePermission(Permissions.ATTACHMENT_DELETE), auditLog('attachment', 'attachment.delete'), (req, res, next) => attachmentController.delete(req, res, next));

export default router;
