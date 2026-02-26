import { z } from 'zod';

export const createTransferListSchema = z.object({
  title: z.string().min(1, 'Tytuł spisu jest wymagany').max(500),
  transferringUnit: z.string().max(255).optional(),
  receivingUnit: z.string().max(255).optional(),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Wymagany format RRRR-MM-DD').optional(),
  notes: z.string().optional(),
});

export const updateTransferListSchema = createTransferListSchema.partial();

export const createTransferListItemSchema = z.object({
  folderSignature: z.string().min(1, 'Znak teczki jest wymagany').max(100),
  folderTitle: z.string().min(1, 'Tytuł teczki jest wymagany').max(1000),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  categoryCode: z.string().min(1, 'Kategoria akt jest wymagana').max(20),
  folderCount: z.number().int().min(1).default(1),
  storageLocation: z.string().max(500).optional().nullable(),
  disposalOrTransferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().optional().nullable(),
  boxId: z.string().uuid('Nieprawidłowy identyfikator kartonu').optional().nullable(),
  boxNumber: z.string().max(100).optional().nullable(),
});

export const updateTransferListItemSchema = createTransferListItemSchema.partial();

export const changeTransferListStatusSchema = z.object({
  status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'archived']),
  notes: z.string().optional(),
});

export const bulkDeleteItemsSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1, 'At least one item ID required'),
});

export const bulkAssignBoxSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1, 'At least one item ID required'),
  boxId: z.string().uuid('Valid box ID required'),
});

export const importTransferListSchema = z.object({
  items: z.array(createTransferListItemSchema).min(1, 'Spis musi zawierać przynajmniej jedną pozycję'),
});
