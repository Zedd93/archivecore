import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { errorResponse, successResponse } from '../../utils/response';
import { Permissions } from '@archivecore/shared';
import { inventoryService } from './inventory.service';
import { z } from 'zod';

const router = Router();
router.use(authenticate, tenantContext, requirePermission(Permissions.INVENTORY_MANAGE));

const uuidSchema = z.string().uuid();

router.get('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.tenantId) return errorResponse(res, 'Wybierz firmę klienta', 400);
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1) return errorResponse(res, 'Nieprawidłowy numer strony', 400);
    return successResponse(res, await inventoryService.listSessions(req.tenantId, page));
  } catch (error) { next(error); }
});

router.post('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.tenantId) return errorResponse(res, 'Wybierz firmę klienta', 400);
    if (!uuidSchema.safeParse(req.body?.locationId).success) return errorResponse(res, 'Wybierz prawidłową lokalizację', 400);
    return successResponse(res, await inventoryService.startSession(req.body.locationId, req.tenantId, req.user!.userId), 201);
  } catch (error) { next(error); }
});

router.get('/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.tenantId) return errorResponse(res, 'Wybierz firmę klienta', 400);
    if (!uuidSchema.safeParse(req.params.id).success) return errorResponse(res, 'Nieprawidłowy identyfikator kontroli', 400);
    return successResponse(res, await inventoryService.getSession(req.params.id, req.tenantId));
  } catch (error) { next(error); }
});

router.post('/sessions/:id/scans', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.tenantId) return errorResponse(res, 'Wybierz firmę klienta', 400);
    if (!uuidSchema.safeParse(req.params.id).success) return errorResponse(res, 'Nieprawidłowy identyfikator kontroli', 400);
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code || code.length > 100) return errorResponse(res, 'Podaj kod QR kartonu', 400);
    return successResponse(res, await inventoryService.scanBox(req.params.id, req.tenantId, code, req.user!.userId));
  } catch (error) { next(error); }
});

router.post('/sessions/:id/scans/:scanId/void', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.tenantId) return errorResponse(res, 'Wybierz firmę klienta', 400);
    if (!uuidSchema.safeParse(req.params.id).success || !uuidSchema.safeParse(req.params.scanId).success) {
      return errorResponse(res, 'Nieprawidłowy identyfikator skanu', 400);
    }
    return successResponse(res, await inventoryService.undoScan(req.params.id, req.params.scanId, req.tenantId, req.user!.userId));
  } catch (error) { next(error); }
});

router.post('/sessions/:id/finish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.tenantId) return errorResponse(res, 'Wybierz firmę klienta', 400);
    if (!uuidSchema.safeParse(req.params.id).success) return errorResponse(res, 'Nieprawidłowy identyfikator kontroli', 400);
    return successResponse(res, await inventoryService.finishSession(req.params.id, req.tenantId, req.user!.userId));
  } catch (error) { next(error); }
});

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
