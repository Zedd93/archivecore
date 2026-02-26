import { Router } from 'express';
import { reportController } from './report.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { Permissions } from '@archivecore/shared';

const router = Router();
const auth = [authenticate, tenantContext];

router.get('/dashboard', ...auth, requirePermission(Permissions.REPORT_VIEW), (req, res, next) => reportController.getDashboard(req, res, next));
router.get('/boxes/status', ...auth, requirePermission(Permissions.REPORT_VIEW), (req, res, next) => reportController.getBoxesByStatus(req, res, next));
router.get('/boxes/doc-type', ...auth, requirePermission(Permissions.REPORT_VIEW), (req, res, next) => reportController.getBoxesByDocType(req, res, next));
router.get('/orders/status', ...auth, requirePermission(Permissions.REPORT_VIEW), (req, res, next) => reportController.getOrdersByStatus(req, res, next));
router.get('/orders/monthly', ...auth, requirePermission(Permissions.REPORT_VIEW), (req, res, next) => reportController.getOrdersByMonth(req, res, next));
router.get('/locations/occupancy', ...auth, requirePermission(Permissions.REPORT_VIEW), (req, res, next) => reportController.getLocationOccupancy(req, res, next));
router.get('/hr/departments', ...auth, requirePermission(Permissions.REPORT_VIEW), (req, res, next) => reportController.getHRFoldersByDepartment(req, res, next));
router.get('/hr/status', ...auth, requirePermission(Permissions.REPORT_VIEW), (req, res, next) => reportController.getHRFoldersByStatus(req, res, next));
router.get('/retention', ...auth, requirePermission(Permissions.REPORT_VIEW), (req, res, next) => reportController.getRetentionSummary(req, res, next));
router.get('/audit-activity', ...auth, requirePermission(Permissions.AUDIT_VIEW), (req, res, next) => reportController.getAuditActivity(req, res, next));
router.get('/sla', ...auth, requirePermission(Permissions.REPORT_VIEW), (req, res, next) => reportController.getSlaPerformance(req, res, next));

export default router;
