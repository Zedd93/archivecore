import { Router } from 'express';
import { userController } from './user.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/audit';
import { Permissions, createUserSchema, updateUserSchema, assignRolesSchema } from '@archivecore/shared';

const router = Router();
const auth = [authenticate, tenantContext];

// Current user
router.get('/me', authenticate, (req, res, next) => userController.getMe(req, res, next));

// Roles list
router.get('/roles', ...auth, requirePermission(Permissions.USER_MANAGE), (req, res, next) => userController.getRoles(req, res, next));

// User CRUD
router.get('/', ...auth, requirePermission(Permissions.USER_MANAGE), (req, res, next) => userController.list(req, res, next));
router.get('/:id', ...auth, requirePermission(Permissions.USER_MANAGE), (req, res, next) => userController.getById(req, res, next));
router.post('/', ...auth, requirePermission(Permissions.USER_MANAGE), validate(createUserSchema), auditLog('user', 'user.create'), (req, res, next) => userController.create(req, res, next));
router.put('/:id', ...auth, requirePermission(Permissions.USER_MANAGE), validate(updateUserSchema), auditLog('user', 'user.update'), (req, res, next) => userController.update(req, res, next));
router.patch('/:id/roles', ...auth, requirePermission(Permissions.USER_MANAGE), validate(assignRolesSchema), auditLog('user', 'user.assign_roles'), (req, res, next) => userController.assignRoles(req, res, next));
router.patch('/:id/deactivate', ...auth, requirePermission(Permissions.USER_MANAGE), auditLog('user', 'user.deactivate'), (req, res, next) => userController.deactivate(req, res, next));

export default router;
