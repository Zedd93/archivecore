import { Router } from 'express';
import { folderController } from './folder.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { auditLog } from '../../middleware/audit';
import { Permissions, createFolderSchema, updateFolderSchema, reorderFoldersSchema } from '@archivecore/shared';
import { validate } from '../../middleware/validate';

const router = Router();
const auth = [authenticate, tenantContext];

router.get('/box/:boxId', ...auth, requirePermission(Permissions.FOLDER_READ), (req, res, next) => folderController.list(req, res, next));
router.get('/:id', ...auth, requirePermission(Permissions.FOLDER_READ), (req, res, next) => folderController.getById(req, res, next));
router.post('/', ...auth, requirePermission(Permissions.FOLDER_WRITE), validate(createFolderSchema), auditLog('folder', 'folder.create'), (req, res, next) => folderController.create(req, res, next));
router.post('/box/:boxId', ...auth, requirePermission(Permissions.FOLDER_WRITE), validate(createFolderSchema), auditLog('folder', 'folder.create'), (req, res, next) => folderController.create(req, res, next));
router.put('/:id', ...auth, requirePermission(Permissions.FOLDER_WRITE), validate(updateFolderSchema), auditLog('folder', 'folder.update'), (req, res, next) => folderController.update(req, res, next));
router.patch('/box/:boxId/reorder', ...auth, requirePermission(Permissions.FOLDER_WRITE), validate(reorderFoldersSchema), (req, res, next) => folderController.reorder(req, res, next));

export default router;
