import { Router } from 'express';
import { z } from 'zod';
import { Permissions } from '@archivecore/shared';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { parsePagination } from '../../utils/pagination';
import { errorResponse, paginatedResponse } from '../../utils/response';
import { custodyService } from './custody.service';

const router = Router();
const targetKind = z.enum(['box', 'folder', 'document', 'hr']);
const permissions = {
  box: Permissions.BOX_READ,
  folder: Permissions.FOLDER_READ,
  document: Permissions.DOCUMENT_READ,
  hr: Permissions.HR_VIEW,
};

router.get('/:kind/:id', authenticate, tenantContext, (req, res, next) => {
  const kind = targetKind.safeParse(req.params.kind);
  if (!kind.success || !z.string().uuid().safeParse(req.params.id).success) {
    return errorResponse(res, 'Nieprawidłowy zasób', 400);
  }
  return requirePermission(permissions[kind.data])(req, res, next);
}, async (req, res, next) => {
  try {
    if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
    const { skip, take, page, limit } = parsePagination(req.query as any);
    const kind = targetKind.parse(req.params.kind);
    const { data, total } = await custodyService.getByTarget(kind, req.params.id, req.tenantId, req.accessDepartment || undefined, skip, take);
    return paginatedResponse(res, data, total, page, limit);
  } catch (error) { next(error); }
});

export default router;
