import { Request, Response, NextFunction } from 'express';
import { Permissions, RoleCode } from '@archivecore/shared';

export function tenantContext(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Niezalogowany' });
  }

  const userTenantId = req.user.tenantId;

  const canSwitchTenant = req.user.roles.includes(RoleCode.SUPER_ADMIN)
    || req.user.permissions.includes(Permissions.TENANT_SWITCH);

  if (!userTenantId && canSwitchTenant) {
    // Global Doxart roles work in a selected client context.
    const headerTenantId = req.headers['x-tenant-id'] as string | undefined;
    req.tenantId = headerTenantId || null;
  } else {
    req.tenantId = userTenantId;
  }

  if (req.user.roles.includes(RoleCode.TENANT_EMPLOYEE)) {
    if (!req.user.department) {
      return res.status(403).json({ success: false, error: 'Konto pracownika nie ma przypisanego działu' });
    }
    req.accessDepartment = req.user.department;
  }

  next();
}
