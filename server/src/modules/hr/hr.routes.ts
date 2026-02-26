import { Router } from 'express';
import { hrController } from './hr.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/audit';
import { Permissions, createHRFolderSchema, createHRDocumentSchema, searchByPeselSchema, updateHRFolderSchema, litigationHoldSchema } from '@archivecore/shared';

const router = Router();
const auth = [authenticate, tenantContext];

// List & read
router.get('/', ...auth, requirePermission(Permissions.HR_VIEW), (req, res, next) => hrController.list(req, res, next));
router.get('/retention-expiring', ...auth, requirePermission(Permissions.HR_VIEW), (req, res, next) => hrController.getRetentionExpiring(req, res, next));
router.get('/:id', ...auth, requirePermission(Permissions.HR_VIEW), (req, res, next) => hrController.getById(req, res, next));

// Create & update
router.post('/', ...auth, requirePermission(Permissions.HR_WRITE), validate(createHRFolderSchema), auditLog('hr_folder', 'hr.create'), (req, res, next) => hrController.create(req, res, next));
router.put('/:id', ...auth, requirePermission(Permissions.HR_WRITE), validate(updateHRFolderSchema), auditLog('hr_folder', 'hr.update'), (req, res, next) => hrController.update(req, res, next));

// PESEL search (requires special permission)
router.post('/search-pesel', ...auth, requirePermission(Permissions.HR_VIEW_PESEL), validate(searchByPeselSchema), auditLog('hr_folder', 'hr.search_pesel'), (req, res, next) => hrController.searchByPesel(req, res, next));

// Litigation hold
router.patch('/:id/litigation-hold', ...auth, requirePermission(Permissions.HR_WRITE), validate(litigationHoldSchema), auditLog('hr_folder', 'hr.litigation_hold'), (req, res, next) => hrController.setLitigationHold(req, res, next));

// Documents within parts
router.post('/parts/:partId/documents', ...auth, requirePermission(Permissions.HR_WRITE), validate(createHRDocumentSchema), auditLog('hr_document', 'hr_doc.create'), (req, res, next) => hrController.addDocument(req, res, next));
router.delete('/documents/:docId', ...auth, requirePermission(Permissions.HR_DELETE), auditLog('hr_document', 'hr_doc.delete'), (req, res, next) => hrController.removeDocument(req, res, next));

export default router;
