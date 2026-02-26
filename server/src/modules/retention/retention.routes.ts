import { Router } from 'express';
import { retentionController } from './retention.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { auditLog } from '../../middleware/audit';
import { Permissions, createRetentionPolicySchema, updateRetentionPolicySchema, initiateDisposalSchema, approveDisposalSchema } from '@archivecore/shared';
import { validate } from '../../middleware/validate';

const router = Router();
const auth = [authenticate, tenantContext];

// Policies
router.get('/policies', ...auth, requirePermission(Permissions.RETENTION_MANAGE), (req, res, next) => retentionController.listPolicies(req, res, next));
router.get('/policies/:id', ...auth, requirePermission(Permissions.RETENTION_MANAGE), (req, res, next) => retentionController.getPolicy(req, res, next));
router.post('/policies', ...auth, requirePermission(Permissions.RETENTION_MANAGE), validate(createRetentionPolicySchema), auditLog('retention_policy', 'policy.create'), (req, res, next) => retentionController.createPolicy(req, res, next));
router.put('/policies/:id', ...auth, requirePermission(Permissions.RETENTION_MANAGE), validate(updateRetentionPolicySchema), auditLog('retention_policy', 'policy.update'), (req, res, next) => retentionController.updatePolicy(req, res, next));
router.delete('/policies/:id', ...auth, requirePermission(Permissions.RETENTION_MANAGE), auditLog('retention_policy', 'policy.delete'), (req, res, next) => retentionController.deletePolicy(req, res, next));
router.post('/policies/:id/recalculate', ...auth, requirePermission(Permissions.RETENTION_MANAGE), (req, res, next) => retentionController.recalculate(req, res, next));

// Review & Disposal
router.get('/review', ...auth, requirePermission(Permissions.DISPOSAL_INITIATE), (req, res, next) => retentionController.getBoxesForReview(req, res, next));
router.post('/disposal/initiate', ...auth, requirePermission(Permissions.DISPOSAL_INITIATE), validate(initiateDisposalSchema), auditLog('disposal', 'disposal.initiate'), (req, res, next) => retentionController.initiateDisposal(req, res, next));
router.post('/disposal/approve', ...auth, requirePermission(Permissions.DISPOSAL_APPROVE), validate(approveDisposalSchema), auditLog('disposal', 'disposal.approve'), (req, res, next) => retentionController.approveDisposal(req, res, next));

export default router;
