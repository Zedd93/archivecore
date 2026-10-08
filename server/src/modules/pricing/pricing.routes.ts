import { Router } from 'express';
import { Permissions, createPriceListSchema, updatePriceListSchema } from '@archivecore/shared';
import { authenticate } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { pricingController } from './pricing.controller';

const router = Router();

router.get('/tenants/:tenantId', authenticate, requirePermission(Permissions.PRICING_MANAGE), (req, res, next) => pricingController.listForTenant(req, res, next));
router.post('/tenants/:tenantId', authenticate, requirePermission(Permissions.PRICING_MANAGE), validate(createPriceListSchema), auditLog('price_list', 'price_list.create'), (req, res, next) => pricingController.create(req, res, next));
router.put('/:id', authenticate, requirePermission(Permissions.PRICING_MANAGE), validate(updatePriceListSchema), auditLog('price_list', 'price_list.update'), (req, res, next) => pricingController.update(req, res, next));
router.post('/:id/activate', authenticate, requirePermission(Permissions.PRICING_MANAGE), auditLog('price_list', 'price_list.activate'), (req, res, next) => pricingController.activate(req, res, next));
router.delete('/:id', authenticate, requirePermission(Permissions.PRICING_MANAGE), auditLog('price_list', 'price_list.delete'), (req, res, next) => pricingController.remove(req, res, next));

export default router;
