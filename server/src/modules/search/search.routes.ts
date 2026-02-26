import { Router } from 'express';
import { searchController } from './search.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { Permissions, searchQuerySchema } from '@archivecore/shared';
import { validate } from '../../middleware/validate';

const router = Router();
const auth = [authenticate, tenantContext];

// GET /api/search?q=query&types=box,folder&limit=20&offset=0
router.get('/', ...auth, requirePermission(Permissions.SEARCH_OWN), validate(searchQuerySchema, 'query'), (req, res, next) => searchController.search(req, res, next));

export default router;
