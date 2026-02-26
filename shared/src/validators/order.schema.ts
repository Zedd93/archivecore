import { z } from 'zod';

export const createOrderSchema = z.object({
  orderType: z.enum(['checkout', 'return_order', 'transfer', 'disposal']),
  priority: z.enum(['normal', 'high', 'urgent']).default('normal'),
  notes: z.string().optional(),
  items: z.array(z.object({
    boxId: z.string().uuid().optional(),
    folderId: z.string().uuid().optional(),
    hrFolderId: z.string().uuid().optional(),
  })).min(1, 'Zlecenie musi zawierać co najmniej jedną pozycję'),
});

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
