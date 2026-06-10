import { z } from 'zod';
import { DOC_TYPES } from '../constants/statuses';

const optionalDocTypeSchema = z.enum(DOC_TYPES).optional();
const boxLocationIdSchema = z.string({
  required_error: 'Lokalizacja jest wymagana',
  invalid_type_error: 'Lokalizacja jest wymagana',
}).uuid('Lokalizacja jest wymagana');

export const createBoxSchema = z.object({
  title: z.string().min(1, 'Tytuł jest wymagany').max(500),
  docType: optionalDocTypeSchema,
  department: z.string().max(200).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  keywords: z.array(z.string()).optional(),
  locationId: boxLocationIdSchema,
  retentionPolicyId: z.string().uuid().optional(),
  notes: z.string().optional(),
  description: z.string().optional(),
  customFields: z.record(z.unknown()).optional(),
});

export const updateBoxSchema = createBoxSchema.partial().extend({
  barcode: z.string().max(100).optional(),
});

export const moveBoxSchema = z.object({
  locationId: boxLocationIdSchema,
  notes: z.string().optional(),
});

export const changeBoxStatusSchema = z.object({
  status: z.enum(['active', 'checked_out', 'pending_disposal', 'disposed', 'lost', 'damaged']),
  notes: z.string().optional(),
});

const bulkBoxIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Wymagane co najmniej jedno ID kartonu').optional(),
  boxIds: z.array(z.string().uuid()).min(1, 'Wymagane co najmniej jedno ID kartonu').optional(),
}).refine((data) => (data.ids?.length || data.boxIds?.length), {
  message: 'Wymagane co najmniej jedno ID kartonu',
  path: ['ids'],
}).transform((data) => ({
  ids: data.ids ?? data.boxIds ?? [],
}));

export const bulkBoxStatusSchema = bulkBoxIdsSchema.and(z.object({
  status: z.enum(['active', 'checked_out', 'pending_disposal', 'disposed', 'lost', 'damaged']),
  notes: z.string().optional(),
}));

export const bulkBoxMoveSchema = bulkBoxIdsSchema.and(z.object({
  locationId: boxLocationIdSchema,
  notes: z.string().optional(),
}));

export const boxFilterSchema = z.object({
  tenantId: z.string().uuid().optional(),
  status: z.enum(['active', 'checked_out', 'pending_disposal', 'disposed', 'lost', 'damaged']).optional(),
  docType: optionalDocTypeSchema,
  locationId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
});
