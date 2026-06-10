import { z } from 'zod';

const orderItemSchema = z.object({
  boxId: z.string().uuid().optional(),
  boxNumber: z.string().min(1).max(50).optional(),
  folderId: z.string().uuid().optional(),
  hrFolderId: z.string().uuid().optional(),
}).refine((item) => item.boxId || item.boxNumber || item.folderId || item.hrFolderId, {
  message: 'Pozycja musi wskazywać karton, teczkę albo akta osobowe',
});

export const createOrderSchema = z.object({
  orderType: z.enum(['checkout', 'return_order', 'transfer', 'disposal']),
  priority: z.enum(['normal', 'high', 'urgent']).default('normal'),
  notes: z.string().optional(),
  items: z.array(orderItemSchema).min(1, 'Zlecenie musi zawierać co najmniej jedną pozycję'),
});

export const addOrderItemSchema = orderItemSchema;

export const assignOrderSchema = z.object({
  assigneeId: z.string().uuid('Valid user ID required'),
});

export const rejectOrderSchema = z.object({
  notes: z.string().min(1, 'Rejection reason is required').max(2000),
});

export const cancelOrderSchema = z.object({
  notes: z.string().max(2000).optional(),
});

export const updateOrderItemStatusSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
});

export const createCustodyEventSchema = z.object({
  boxId: z.string().uuid(),
  eventType: z.enum(['handover', 'receipt', 'return_event', 'transfer']),
  toUserId: z.string().uuid().optional(),
  toLocationId: z.string().uuid().optional(),
  notes: z.string().optional(),
  signatureData: z.string().optional(),
});
