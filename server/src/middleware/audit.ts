import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeIpAddress(value: string | undefined): string | undefined {
  if (!value) return undefined;

  let ip = value.split(',')[0]?.trim();
  if (!ip || ip.toLowerCase() === 'unknown') return undefined;

  ip = ip.replace(/^"|"$/g, '');

  if (ip.startsWith('[')) {
    const end = ip.indexOf(']');
    if (end > 0) ip = ip.slice(1, end);
  } else {
    const ipv4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (ipv4WithPort) ip = ipv4WithPort[1];
  }

  if (ip.startsWith('::ffff:')) ip = ip.slice('::ffff:'.length);
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return '127.0.0.1';

  return ip;
}

function getClientIp(req: Request): string | undefined {
  const candidates = [
    firstHeaderValue(req.headers['x-forwarded-for']),
    firstHeaderValue(req.headers['x-real-ip']),
    firstHeaderValue(req.headers['cf-connecting-ip']),
    firstHeaderValue(req.headers['true-client-ip']),
    ...req.ips,
    req.ip,
    req.socket.remoteAddress,
  ];

  for (const candidate of candidates) {
    const ip = normalizeIpAddress(candidate);
    if (ip) return ip;
  }

  return undefined;
}

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
            ipAddress: getClientIp(req),
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
