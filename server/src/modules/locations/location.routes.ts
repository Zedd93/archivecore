import { Router } from 'express';
import { locationController } from './location.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { Permissions, createLocationSchema, updateLocationSchema } from '@archivecore/shared';
import { validate } from '../../middleware/validate';

const router = Router();
const auth = [authenticate, tenantContext];

router.get('/tree', ...auth, requirePermission(Permissions.LOCATION_READ), (r, s, n) => locationController.getTree(r, s, n));
router.get('/available-slots', ...auth, requirePermission(Permissions.LOCATION_READ), (r, s, n) => locationController.getAvailableSlots(r, s, n));
router.get('/:id', ...auth, requirePermission(Permissions.LOCATION_READ), (r, s, n) => locationController.getById(r, s, n));
router.get('/:id/boxes', ...auth, requirePermission(Permissions.LOCATION_READ), (r, s, n) => locationController.getBoxes(r, s, n));
router.post('/', ...auth, requirePermission(Permissions.LOCATION_WRITE), validate(createLocationSchema), (r, s, n) => locationController.create(r, s, n));
router.put('/:id', ...auth, requirePermission(Permissions.LOCATION_WRITE), validate(updateLocationSchema), (r, s, n) => locationController.update(r, s, n));

export default router;
