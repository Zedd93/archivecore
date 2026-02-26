import { Request, Response, NextFunction } from 'express';
import { RoleCode } from '@archivecore/shared';

export function tenantContext(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Niezalogowany' });
  }

  const userTenantId = req.user.tenantId;

  if (!userTenantId && req.user.roles.includes(RoleCode.SUPER_ADMIN)) {
    // Super Admin can set tenant context via header
    const headerTenantId = req.headers['x-tenant-id'] as string | undefined;
    req.tenantId = headerTenantId || null;
  } else {
    req.tenantId = userTenantId;
  }

  next();
}
