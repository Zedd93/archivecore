import { z } from 'zod';

export const createBoxSchema = z.object({
  title: z.string().min(1, 'Tytuł jest wymagany').max(500),
  docType: z.string().max(100).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  keywords: z.array(z.string()).optional(),
  locationId: z.string().uuid().optional(),
  retentionPolicyId: z.string().uuid().optional(),
  notes: z.string().optional(),
  description: z.string().optional(),
  customFields: z.record(z.unknown()).optional(),
});

export const updateBoxSchema = createBoxSchema.partial().extend({
  barcode: z.string().max(100).optional(),
});

export const moveBoxSchema = z.object({
  locationId: z.string().uuid('Lokalizacja jest wymagana'),
  notes: z.string().optional(),
});

export const changeBoxStatusSchema = z.object({
  status: z.enum(['active', 'checked_out', 'pending_disposal', 'disposed', 'lost', 'damaged']),
  notes: z.string().optional(),
});

export const bulkBoxStatusSchema = z.object({
  boxIds: z.array(z.string().uuid()).min(1, 'At least one box ID required'),
  status: z.enum(['active', 'checked_out', 'pending_disposal', 'disposed', 'lost', 'damaged']),
  notes: z.string().optional(),
});

export const bulkBoxMoveSchema = z.object({
  boxIds: z.array(z.string().uuid()).min(1, 'At least one box ID required'),
  locationId: z.string().uuid('Location is required'),
  notes: z.string().optional(),
});

export const boxFilterSchema = z.object({
  tenantId: z.string().uuid().optional(),
  status: z.enum(['active', 'checked_out', 'pending_disposal', 'disposed', 'lost', 'damaged']).optional(),
  docType: z.string().optional(),
  locationId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
});
