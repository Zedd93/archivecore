import { Request, Response, NextFunction } from 'express';

export function requirePermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Niezalogowany' });
    }

    const userPermissions: string[] = req.user.permissions || [];
    const hasPermission = permissions.some((p) => userPermissions.includes(p));

    if (!hasPermission) {
      return res.status(403).json({ success: false, error: 'Brak uprawnień do wykonania tej operacji' });
    }

    next();
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Niezalogowany' });
    }

    const userRoles: string[] = req.user.roles || [];
    const hasRole = roles.some((r) => userRoles.includes(r));

    if (!hasRole) {
      return res.status(403).json({ success: false, error: 'Brak wymaganej roli' });
    }

    next();
  };
}
