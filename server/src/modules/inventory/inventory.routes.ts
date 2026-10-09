import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { errorResponse, successResponse } from '../../utils/response';
import { Permissions } from '@archivecore/shared';
import { inventoryService } from './inventory.service';

const router = Router();
router.use(authenticate, tenantContext, requirePermission(Permissions.INVENTORY_MANAGE));

router.get('/locations/:id/snapshot', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.tenantId) return errorResponse(res, 'Wybierz firmę klienta', 400);
    return successResponse(res, await inventoryService.snapshot(req.params.id, req.tenantId));
  } catch (error) { next(error); }
});

router.get('/boxes/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.tenantId) return errorResponse(res, 'Wybierz firmę klienta', 400);
    const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
    if (!code || code.length > 100) return errorResponse(res, 'Podaj kod QR kartonu', 400);
    return successResponse(res, await inventoryService.resolveBox(code, req.tenantId));
  } catch (error) { next(error); }
});

export default router;
