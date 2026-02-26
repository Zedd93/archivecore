import { Router } from 'express';
import { transferListController } from './transfer-list.controller';
import { authenticate } from '../../middleware/auth';
import { tenantContext } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/audit';
import { fileUpload } from '../../middleware/upload';
import {
  Permissions,
  createTransferListSchema,
  updateTransferListSchema,
  createTransferListItemSchema,
  updateTransferListItemSchema,
  changeTransferListStatusSchema,
  bulkDeleteItemsSchema,
  bulkAssignBoxSchema,
  importTransferListSchema,
} from '@archivecore/shared';

const router = Router();
const auth = [authenticate, tenantContext];

// ─── Transfer Lists ──────────────────────────────────────
router.get('/',
  ...auth,
  requirePermission(Permissions.TRANSFER_LIST_READ),
  (req, res, next) => transferListController.list(req, res, next)
);

router.get('/:id',
  ...auth,
  requirePermission(Permissions.TRANSFER_LIST_READ),
  (req, res, next) => transferListController.getById(req, res, next)
);

router.post('/',
  ...auth,
  requirePermission(Permissions.TRANSFER_LIST_WRITE),
  validate(createTransferListSchema),
  auditLog('transfer_list', 'transfer_list.create'),
  (req, res, next) => transferListController.create(req, res, next)
);

router.put('/:id',
  ...auth,
  requirePermission(Permissions.TRANSFER_LIST_WRITE),
  validate(updateTransferListSchema),
  auditLog('transfer_list', 'transfer_list.update'),
  (req, res, next) => transferListController.update(req, res, next)
);

router.delete('/:id',
  ...auth,
  requirePermission(Permissions.TRANSFER_LIST_WRITE),
  auditLog('transfer_list', 'transfer_list.delete'),
  (req, res, next) => transferListController.delete(req, res, next)
);

router.patch('/:id/status',
  ...auth,
  requirePermission(Permissions.TRANSFER_LIST_WRITE),
  validate(changeTransferListStatusSchema),
  auditLog('transfer_list', 'transfer_list.status'),
  (req, res, next) => transferListController.changeStatus(req, res, next)
);

// ─── Transfer List Items ─────────────────────────────────
router.get('/:id/items',
  ...auth,
  requirePermission(Permissions.TRANSFER_LIST_READ),
  (req, res, next) => transferListController.getItems(req, res, next)
);

router.post('/:id/items',
  ...auth,
  requirePermission(Permissions.TRANSFER_LIST_WRITE),
  validate(createTransferListItemSchema),
  auditLog('transfer_list_item', 'transfer_list_item.create'),
  (req, res, next) => transferListController.addItem(req, res, next)
);

router.put('/:id/items/:itemId',
  ...auth,
  requirePermission(Permissions.TRANSFER_LIST_WRITE),
  validate(updateTransferListItemSchema),
  auditLog('transfer_list_item', 'transfer_list_item.update'),
  (req, res, next) => transferListController.updateItem(req, res, next)
);

router.delete('/:id/items/:itemId',
  ...auth,
  requirePermission(Permissions.TRANSFER_LIST_WRITE),
  auditLog('transfer_list_item', 'transfer_list_item.delete'),
  (req, res, next) => transferListController.deleteItem(req, res, next)
);

// ─── Bulk operations on items ─────────────────────────────
router.post('/:id/items/bulk-delete',
  ...auth,
  requirePermission(Permissions.TRANSFER_LIST_WRITE),
  validate(bulkDeleteItemsSchema),
  auditLog('transfer_list_item', 'transfer_list_item.bulk_delete'),
  (req, res, next) => transferListController.bulkDeleteItems(req, res, next)
);

router.post('/:id/items/bulk-assign-box',
  ...auth,
  requirePermission(Permissions.TRANSFER_LIST_WRITE),
  validate(bulkAssignBoxSchema),
  auditLog('transfer_list_item', 'transfer_list_item.bulk_assign_box'),
  (req, res, next) => transferListController.bulkAssignBox(req, res, next)
);

// ─── Import from Excel/CSV ───────────────────────────────
router.post('/:id/import',
  ...auth,
  requirePermission(Permissions.TRANSFER_LIST_IMPORT),
  fileUpload.single('file'),
  validate(importTransferListSchema),
  auditLog('transfer_list', 'transfer_list.import'),
  (req, res, next) => transferListController.importFile(req, res, next)
);

export default router;
