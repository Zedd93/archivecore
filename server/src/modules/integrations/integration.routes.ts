import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { Permissions } from '@archivecore/shared';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { successResponse } from '../../utils/response';
import { integrationService } from './integration.service';

const management = Router();
management.use(authenticate, tenantContext, requirePermission(Permissions.INTEGRATION_MANAGE));

function tenantId(req: Request) {
  if (!req.tenantId) throw Object.assign(new Error('Wybierz klienta przed zarządzaniem integracjami'), { statusCode: 400 });
  return req.tenantId;
}

const createKeySchema = z.object({
  name: z.string().trim().min(3).max(100),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});

management.get('/keys', async (req, res, next) => {
  try { return successResponse(res, await integrationService.listKeys(tenantId(req))); }
  catch (error) { next(error); }
});

management.post('/keys', validate(createKeySchema), async (req, res, next) => {
  try {
    const key = await integrationService.createKey(
      tenantId(req), req.user!.userId, req.body.name, req.body.expiresInDays, req.ip,
    );
    res.setHeader('Cache-Control', 'no-store');
    return successResponse(res, key, 201);
  } catch (error) { next(error); }
});

management.delete('/keys/:id', validate(z.object({ id: z.string().uuid() }), 'params'), async (req, res, next) => {
  try { return successResponse(res, await integrationService.revokeKey(tenantId(req), req.user!.userId, req.params.id, req.ip)); }
  catch (error) { next(error); }
});

const publicApi = Router();
publicApi.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
publicApi.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
publicApi.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    const integrationTenantId = match ? await integrationService.authenticate(match[1]) : null;
    if (!integrationTenantId) return res.status(401).json({ success: false, error: 'Nieprawidłowy lub wygasły klucz API' });
    res.locals.integrationTenantId = integrationTenantId;
    next();
  } catch (error) { next(error); }
});

const listOrdersSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.nativeEnum(OrderStatus).optional(),
  cursor: z.string().uuid().optional(),
});

publicApi.get('/orders', validate(listOrdersSchema, 'query'), async (req, res, next) => {
  try {
    const result = await integrationService.listOrders(
      res.locals.integrationTenantId as string,
      Number(req.query.limit),
      req.query.status as OrderStatus | undefined,
      req.query.cursor as string | undefined,
    );
    return successResponse(res, result);
  } catch (error) { next(error); }
});

publicApi.get('/orders/:id', validate(z.object({ id: z.string().uuid() }), 'params'), async (req, res, next) => {
  try { return successResponse(res, await integrationService.getOrder(res.locals.integrationTenantId as string, req.params.id)); }
  catch (error) { next(error); }
});

export { management as integrationManagementRoutes, publicApi as integrationPublicRoutes };
