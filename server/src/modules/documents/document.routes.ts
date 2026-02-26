import { Router } from 'express';
import { documentController } from './document.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { auditLog } from '../../middleware/audit';
import { Permissions, createDocumentSchema, updateDocumentSchema } from '@archivecore/shared';
import { validate } from '../../middleware/validate';

const router = Router();
const auth = [authenticate, tenantContext];

router.get('/', ...auth, requirePermission(Permissions.DOCUMENT_READ), (req, res, next) => documentController.list(req, res, next));
router.get('/:id', ...auth, requirePermission(Permissions.DOCUMENT_READ), (req, res, next) => documentController.getById(req, res, next));
router.post('/', ...auth, requirePermission(Permissions.DOCUMENT_WRITE), validate(createDocumentSchema), auditLog('document', 'document.create'), (req, res, next) => documentController.create(req, res, next));
router.put('/:id', ...auth, requirePermission(Permissions.DOCUMENT_WRITE), validate(updateDocumentSchema), auditLog('document', 'document.update'), (req, res, next) => documentController.update(req, res, next));
router.delete('/:id', ...auth, requirePermission(Permissions.DOCUMENT_WRITE), auditLog('document', 'document.delete'), (req, res, next) => documentController.delete(req, res, next));

export default router;
