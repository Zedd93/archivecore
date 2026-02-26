import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';

export function auditLog(entityType: string, action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = function (body: any) {
      // Log audit asynchronously (don't block response)
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        const entityId = body?.data?.id || req.params.id || req.params.boxId || req.params.folderId;

        prisma.auditLog.create({
          data: {
            tenantId: req.tenantId || undefined,
            userId: req.user.userId,
            action,
            entityType,
            entityId: entityId || undefined,
            newValues: body?.data ? JSON.parse(JSON.stringify(body.data)) : undefined,
            ipAddress: req.ip || req.socket.remoteAddress,
            userAgent: req.headers['user-agent']?.substring(0, 500),
          },
        }).catch((err) => {
          console.error('Audit log error:', err.message);
        });
      }

      return originalJson(body);
    };

    next();
  };
}
