import { IJwtPayload } from '@archivecore/shared';

declare global {
  namespace Express {
    interface Request {
      user?: IJwtPayload;
      tenantId?: string | null;
    }
  }
}

export {};
