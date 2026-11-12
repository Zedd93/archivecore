import { Router } from 'express';
import { searchController } from './search.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission, requireRole } from '../../middleware/rbac';
import { Permissions, RoleCode, searchEvidenceQuerySchema, searchQuerySchema } from '@archivecore/shared';
import { validate } from '../../middleware/validate';
import { config } from '../../config/env';
import { z } from 'zod';

const router = Router();
const auth = [authenticate, tenantContext];
const semanticPilotQuery = z.object({
  q: z.string().trim().min(3).max(300),
  limit: z.coerce.number().int().min(1).max(10).default(10),
});

router.get('/semantic-pilot', (req, res, next) => {
  if (!config.semanticPilot.enabled) return res.status(404).json({ success: false, error: 'Nie znaleziono zasobu' });
  next();
}, ...auth, requireRole(RoleCode.SUPER_ADMIN), requirePermission(Permissions.SEARCH_ALL),
validate(semanticPilotQuery, 'query'), (req, res, next) => searchController.semanticPilot(req, res, next));

router.get('/evidence', ...auth, requirePermission(Permissions.SEARCH_OWN, Permissions.SEARCH_ALL), validate(searchEvidenceQuerySchema, 'query'), (req, res, next) => searchController.evidence(req, res, next));

// GET /api/search?q=query&types=box,folder&limit=20&offset=0
router.get('/', ...auth, requirePermission(Permissions.SEARCH_OWN, Permissions.SEARCH_ALL), validate(searchQuerySchema, 'query'), (req, res, next) => searchController.search(req, res, next));

export default router;
