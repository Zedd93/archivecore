import { Router } from 'express';
import { retentionController } from './retention.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { auditLog } from '../../middleware/audit';
import { fileUpload } from '../../middleware/upload';
import { Permissions, createRetentionPolicySchema, updateRetentionPolicySchema, initiateDisposalSchema, reviewDisposalSchema, apDisposalDecisionSchema, approveDisposalSchema, secondApproveDisposalSchema, rejectDisposalSchema, withdrawDisposalSchema, completeDisposalSchema, documentationLegalHoldSchema } from '@archivecore/shared';
import { validate } from '../../middleware/validate';
import multer from 'multer';

const router = Router();
const auth = [authenticate, tenantContext];
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'image/jpeg' || file.mimetype === 'image/png'),
});

// Policies
router.get('/policies', ...auth, requirePermission(Permissions.RETENTION_MANAGE), (req, res, next) => retentionController.listPolicies(req, res, next));
router.get('/policies/jrwa/versions', ...auth, requirePermission(Permissions.RETENTION_MANAGE), (req, res, next) => retentionController.listJrwaVersions(req, res, next));
router.post('/policies/jrwa/preview', ...auth, requirePermission(Permissions.SYSTEM_CONFIG), fileUpload.single('file'), (req, res, next) => retentionController.previewJrwa(req, res, next));
router.post('/policies/jrwa/import', ...auth, requirePermission(Permissions.SYSTEM_CONFIG), fileUpload.single('file'), auditLog('retention_policy', 'policy.jrwa_import'), (req, res, next) => retentionController.importJrwa(req, res, next));
router.patch('/policies/:id/series/legal-hold', ...auth, requirePermission(Permissions.RETENTION_MANAGE), validate(documentationLegalHoldSchema), (req, res, next) => retentionController.setJrwaSeriesLegalHold(req, res, next));
router.get('/policies/:id', ...auth, requirePermission(Permissions.RETENTION_MANAGE), (req, res, next) => retentionController.getPolicy(req, res, next));
router.post('/policies', ...auth, requirePermission(Permissions.RETENTION_MANAGE), validate(createRetentionPolicySchema), auditLog('retention_policy', 'policy.create'), (req, res, next) => retentionController.createPolicy(req, res, next));
router.put('/policies/:id', ...auth, requirePermission(Permissions.RETENTION_MANAGE), validate(updateRetentionPolicySchema), auditLog('retention_policy', 'policy.update'), (req, res, next) => retentionController.updatePolicy(req, res, next));
router.delete('/policies/:id', ...auth, requirePermission(Permissions.RETENTION_MANAGE), auditLog('retention_policy', 'policy.delete'), (req, res, next) => retentionController.deletePolicy(req, res, next));
router.post('/policies/:id/recalculate', ...auth, requirePermission(Permissions.RETENTION_MANAGE), (req, res, next) => retentionController.recalculate(req, res, next));

// Review & Disposal
router.get('/review', ...auth, requirePermission(Permissions.DISPOSAL_INITIATE), (req, res, next) => retentionController.getBoxesForReview(req, res, next));
router.get('/disposal/pending', ...auth, requirePermission(Permissions.DISPOSAL_INITIATE, Permissions.DISPOSAL_APPROVE), (req, res, next) => retentionController.getPendingDisposal(req, res, next));
router.get('/disposal/approved', ...auth, requirePermission(Permissions.DISPOSAL_APPROVE, Permissions.DISPOSAL_COMPLETE), (req, res, next) => retentionController.getApprovedDisposal(req, res, next));
router.get('/disposal/completed', ...auth, requirePermission(Permissions.DISPOSAL_APPROVE, Permissions.DISPOSAL_COMPLETE), (req, res, next) => retentionController.getCompletedDisposal(req, res, next));
router.get('/disposal/completed/:id/pdf', ...auth, requirePermission(Permissions.DISPOSAL_APPROVE, Permissions.DISPOSAL_COMPLETE), (req, res, next) => retentionController.downloadDisposalConfirmation(req, res, next));
router.get('/disposal/completed/:id/evidence', ...auth, requirePermission(Permissions.DISPOSAL_APPROVE, Permissions.DISPOSAL_COMPLETE), (req, res, next) => retentionController.listDisposalEvidence(req, res, next));
router.post('/disposal/completed/:id/evidence', ...auth, requirePermission(Permissions.DISPOSAL_COMPLETE), evidenceUpload.single('file'), auditLog('disposal_evidence', 'disposal_evidence.upload'), (req, res, next) => retentionController.uploadDisposalEvidence(req, res, next));
router.get('/disposal/completed/:id/evidence/:evidenceId/file', ...auth, requirePermission(Permissions.DISPOSAL_APPROVE, Permissions.DISPOSAL_COMPLETE), (req, res, next) => retentionController.downloadDisposalEvidence(req, res, next));
router.post('/disposal/initiate', ...auth, requirePermission(Permissions.DISPOSAL_INITIATE), validate(initiateDisposalSchema), auditLog('disposal', 'disposal.initiate'), (req, res, next) => retentionController.initiateDisposal(req, res, next));
router.post('/disposal/review', ...auth, requirePermission(Permissions.DISPOSAL_INITIATE), validate(reviewDisposalSchema), auditLog('disposal', 'disposal.review'), (req, res, next) => retentionController.reviewDisposal(req, res, next));
router.post('/disposal/approve', ...auth, requirePermission(Permissions.DISPOSAL_APPROVE), validate(approveDisposalSchema), auditLog('disposal', 'disposal.approve'), (req, res, next) => retentionController.approveDisposal(req, res, next));
router.post('/disposal/second-approve', ...auth, requirePermission(Permissions.DISPOSAL_APPROVE), validate(secondApproveDisposalSchema), auditLog('disposal', 'disposal.second_approve'), (req, res, next) => retentionController.secondApproveDisposal(req, res, next));
router.post('/disposal/reject', ...auth, requirePermission(Permissions.DISPOSAL_APPROVE), validate(rejectDisposalSchema), auditLog('disposal', 'disposal.reject'), (req, res, next) => retentionController.rejectDisposal(req, res, next));
router.post('/disposal/withdraw', ...auth, requirePermission(Permissions.DISPOSAL_APPROVE), validate(withdrawDisposalSchema), auditLog('disposal', 'disposal.withdraw'), (req, res, next) => retentionController.withdrawDisposal(req, res, next));
router.post('/disposal/ap-decision', ...auth, requirePermission(Permissions.DISPOSAL_COMPLETE), validate(apDisposalDecisionSchema), auditLog('disposal', 'disposal.ap_decision'), (req, res, next) => retentionController.recordApDecision(req, res, next));
router.post('/disposal/complete', ...auth, requirePermission(Permissions.DISPOSAL_COMPLETE), validate(completeDisposalSchema), auditLog('disposal', 'disposal.complete'), (req, res, next) => retentionController.completeDisposal(req, res, next));

export default router;
