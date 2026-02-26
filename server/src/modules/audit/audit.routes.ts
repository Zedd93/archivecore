import { Router } from 'express';
import { auditController } from './audit.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { Permissions } from '@archivecore/shared';

const router = Router();
const auth = [authenticate, tenantContext];

router.get('/', ...auth, requirePermission(Permissions.AUDIT_VIEW), (req, res, next) => auditController.list(req, res, next));
router.get('/actions', ...auth, requirePermission(Permissions.AUDIT_VIEW), (req, res, next) => auditController.getActions(req, res, next));
router.get('/entity-types', ...auth, requirePermission(Permissions.AUDIT_VIEW), (req, res, next) => auditController.getEntityTypes(req, res, next));
router.get('/:id', ...auth, requirePermission(Permissions.AUDIT_VIEW), (req, res, next) => auditController.getById(req, res, next));

export default router;
