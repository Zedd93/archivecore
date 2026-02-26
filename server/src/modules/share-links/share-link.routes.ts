import { Router } from 'express';
import { ShareLinkController } from './share-link.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { validate } from '../../middleware/validate';
import { createShareLinkSchema } from '@archivecore/shared';

const router = Router();
const auth = [authenticate, tenantContext];

// ─── Authenticated routes ───────────────────────────────
router.post('/', ...auth, validate(createShareLinkSchema), ShareLinkController.create);
router.get('/', ...auth, ShareLinkController.list);
router.delete('/:id', ...auth, ShareLinkController.delete);

export default router;
