import { Router } from 'express';
import {
  Permissions,
  billingMonthActionSchema,
  billingEventsQuerySchema,
  billingExportQuerySchema,
  confirmBillingInvoiceSchema,
  createPriceListSchema,
  excludeBillingEventSchema,
  updatePriceListSchema,
} from '@archivecore/shared';
import { authenticate } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { pricingController } from './pricing.controller';

const router = Router();

router.get('/tenants/:tenantId', authenticate, requirePermission(Permissions.PRICING_MANAGE), (req, res, next) => pricingController.listForTenant(req, res, next));
router.get('/tenants/:tenantId/events', authenticate, requirePermission(Permissions.PRICING_MANAGE), validate(billingEventsQuerySchema, 'query'), (req, res, next) => pricingController.listBillingEvents(req, res, next));
router.get('/tenants/:tenantId/periods/export', authenticate, requirePermission(Permissions.PRICING_MANAGE), validate(billingExportQuerySchema, 'query'), (req, res, next) => pricingController.exportBillingPeriod(req, res, next));
router.post('/tenants/:tenantId/events/storage', authenticate, requirePermission(Permissions.PRICING_MANAGE), validate(billingMonthActionSchema), auditLog('billing_period', 'billing.storage.generate'), (req, res, next) => pricingController.generateMonthlyStorage(req, res, next));
router.post('/tenants/:tenantId/periods/close', authenticate, requirePermission(Permissions.PRICING_MANAGE), validate(billingMonthActionSchema), auditLog('billing_period', 'billing.period.close'), (req, res, next) => pricingController.closeBillingPeriod(req, res, next));
router.post('/tenants/:tenantId/periods/invoice', authenticate, requirePermission(Permissions.PRICING_MANAGE), validate(confirmBillingInvoiceSchema), (req, res, next) => pricingController.confirmBillingInvoice(req, res, next));
router.post('/tenants/:tenantId', authenticate, requirePermission(Permissions.PRICING_MANAGE), validate(createPriceListSchema), auditLog('price_list', 'price_list.create'), (req, res, next) => pricingController.create(req, res, next));
router.put('/:id', authenticate, requirePermission(Permissions.PRICING_MANAGE), validate(updatePriceListSchema), auditLog('price_list', 'price_list.update'), (req, res, next) => pricingController.update(req, res, next));
router.post('/:id/activate', authenticate, requirePermission(Permissions.PRICING_MANAGE), auditLog('price_list', 'price_list.activate'), (req, res, next) => pricingController.activate(req, res, next));
router.delete('/:id', authenticate, requirePermission(Permissions.PRICING_MANAGE), auditLog('price_list', 'price_list.delete'), (req, res, next) => pricingController.remove(req, res, next));
router.patch('/events/:id/exclude', authenticate, requirePermission(Permissions.PRICING_MANAGE), validate(excludeBillingEventSchema), auditLog('billing_event', 'billing_event.exclude'), (req, res, next) => pricingController.excludeBillingEvent(req, res, next));
router.patch('/events/:id/restore', authenticate, requirePermission(Permissions.PRICING_MANAGE), auditLog('billing_event', 'billing_event.restore'), (req, res, next) => pricingController.restoreBillingEvent(req, res, next));

export default router;
