import { Router } from 'express';
import { attachmentController } from './attachment.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { auditLog } from '../../middleware/audit';
import { fileUpload, scanBatchUpload } from '../../middleware/upload';
import { Permissions } from '@archivecore/shared';
import multer from 'multer';

const router = Router();
const auth = [authenticate, tenantContext];
const uploadScanBatch = (req: Parameters<ReturnType<typeof scanBatchUpload.single>>[0], res: Parameters<ReturnType<typeof scanBatchUpload.single>>[1], next: Parameters<ReturnType<typeof scanBatchUpload.single>>[2]) => {
  scanBatchUpload.single('file')(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(Object.assign(new Error('Wsad PDF nie może przekraczać 20 MB'), { statusCode: 413 }));
    }
    next(error);
  });
};

router.post('/scan-batch/preview', ...auth, requirePermission(Permissions.IMPORT_DATA), requirePermission(Permissions.ATTACHMENT_UPLOAD), uploadScanBatch, (req, res, next) => attachmentController.previewScanBatch(req, res, next));
router.post('/scan-batch/commit', ...auth, requirePermission(Permissions.IMPORT_DATA), requirePermission(Permissions.ATTACHMENT_UPLOAD), uploadScanBatch, auditLog('attachment', 'attachment.upload'), (req, res, next) => attachmentController.commitScanBatch(req, res, next));
router.get('/', ...auth, requirePermission(Permissions.ATTACHMENT_READ), (req, res, next) => attachmentController.list(req, res, next));
router.get('/:id/download', ...auth, requirePermission(Permissions.ATTACHMENT_READ), (req, res, next) => attachmentController.download(req, res, next));
router.get('/:id/redacted-copy', ...auth, requirePermission(Permissions.ATTACHMENT_READ), (req, res, next) => attachmentController.downloadPeselRedactedCopy(req, res, next));
router.get('/:id/sensitivity', ...auth, requirePermission(Permissions.ATTACHMENT_READ), (req, res, next) => attachmentController.analyzeSensitivity(req, res, next));
router.post('/', ...auth, requirePermission(Permissions.ATTACHMENT_UPLOAD), fileUpload.single('file'), auditLog('attachment', 'attachment.upload'), (req, res, next) => attachmentController.upload(req, res, next));
router.delete('/:id', ...auth, requirePermission(Permissions.ATTACHMENT_DELETE), auditLog('attachment', 'attachment.delete'), (req, res, next) => attachmentController.delete(req, res, next));

export default router;
