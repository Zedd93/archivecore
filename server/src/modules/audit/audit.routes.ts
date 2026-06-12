import { Router } from 'express';
import { auditController } from './audit.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission, requireRole } from '../../middleware/rbac';
import { Permissions, RoleCode } from '@archivecore/shared';

const router = Router();
const auth = [authenticate, tenantContext];

router.get('/', ...auth, requirePermission(Permissions.AUDIT_VIEW), (req, res, next) => auditController.list(req, res, next));
router.get('/actions', ...auth, requirePermission(Permissions.AUDIT_VIEW), (req, res, next) => auditController.getActions(req, res, next));
router.get('/entity-types', ...auth, requirePermission(Permissions.AUDIT_VIEW), (req, res, next) => auditController.getEntityTypes(req, res, next));
router.post('/:id/revert', ...auth, requirePermission(Permissions.AUDIT_VIEW), requireRole(RoleCode.SUPER_ADMIN), (req, res, next) => auditController.revert(req, res, next));
router.get('/:id', ...auth, requirePermission(Permissions.AUDIT_VIEW), (req, res, next) => auditController.getById(req, res, next));

export default router;
