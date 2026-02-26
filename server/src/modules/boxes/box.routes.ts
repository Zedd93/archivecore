import { Router } from 'express';
import { boxController } from './box.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/audit';
import { Permissions, createBoxSchema, updateBoxSchema, moveBoxSchema, changeBoxStatusSchema, bulkBoxStatusSchema, bulkBoxMoveSchema } from '@archivecore/shared';

const router = Router();
const auth = [authenticate, tenantContext];

router.get('/', ...auth, requirePermission(Permissions.BOX_READ), (req, res, next) => boxController.list(req, res, next));
router.get('/:id', ...auth, requirePermission(Permissions.BOX_READ), (req, res, next) => boxController.getById(req, res, next));
router.post('/', ...auth, requirePermission(Permissions.BOX_WRITE), validate(createBoxSchema), auditLog('box', 'box.create'), (req, res, next) => boxController.create(req, res, next));
router.put('/:id', ...auth, requirePermission(Permissions.BOX_WRITE), validate(updateBoxSchema), auditLog('box', 'box.update'), (req, res, next) => boxController.update(req, res, next));
router.patch('/:id/move', ...auth, requirePermission(Permissions.BOX_MOVE), validate(moveBoxSchema), auditLog('box', 'box.move'), (req, res, next) => boxController.move(req, res, next));
router.patch('/:id/status', ...auth, requirePermission(Permissions.BOX_STATUS), validate(changeBoxStatusSchema), auditLog('box', 'box.status'), (req, res, next) => boxController.changeStatus(req, res, next));
router.post('/bulk-status', ...auth, requirePermission(Permissions.BOX_STATUS), validate(bulkBoxStatusSchema), auditLog('box', 'box.bulk_status'), (req, res, next) => boxController.bulkChangeStatus(req, res, next));
router.post('/bulk-move', ...auth, requirePermission(Permissions.BOX_MOVE), validate(bulkBoxMoveSchema), auditLog('box', 'box.bulk_move'), (req, res, next) => boxController.bulkMove(req, res, next));
router.get('/:id/history', ...auth, requirePermission(Permissions.BOX_READ), (req, res, next) => boxController.getHistory(req, res, next));

export default router;
