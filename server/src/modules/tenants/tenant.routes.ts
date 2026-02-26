import { Router } from 'express';
import { tenantController } from './tenant.controller';
import { authenticate } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { auditLog } from '../../middleware/audit';
import { Permissions, createTenantSchema, updateTenantSchema } from '@archivecore/shared';
import { validate } from '../../middleware/validate';

const router = Router();

router.get('/', authenticate, requirePermission(Permissions.TENANT_MANAGE), (req, res, next) => tenantController.list(req, res, next));
router.get('/:id', authenticate, requirePermission(Permissions.TENANT_MANAGE), (req, res, next) => tenantController.getById(req, res, next));
router.get('/:id/stats', authenticate, requirePermission(Permissions.TENANT_MANAGE), (req, res, next) => tenantController.getStats(req, res, next));
router.post('/', authenticate, requirePermission(Permissions.TENANT_MANAGE), validate(createTenantSchema), auditLog('tenant', 'tenant.create'), (req, res, next) => tenantController.create(req, res, next));
router.put('/:id', authenticate, requirePermission(Permissions.TENANT_MANAGE), validate(updateTenantSchema), auditLog('tenant', 'tenant.update'), (req, res, next) => tenantController.update(req, res, next));

export default router;
