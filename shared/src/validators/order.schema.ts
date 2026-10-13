import { z } from 'zod';

const orderItemSchema = z.object({
  boxId: z.string().uuid().optional(),
  boxNumber: z.string().min(1).max(50).optional(),
  folderId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
  transferListItemId: z.string().uuid().optional(),
  hrFolderId: z.string().uuid().optional(),
}).refine((item) => item.boxId || item.boxNumber || item.folderId || item.documentId || item.transferListItemId || item.hrFolderId, {
  message: 'Pozycja musi wskazywać karton, teczkę, dokument albo akta osobowe',
});

export const createOrderSchema = z.object({
  orderType: z.enum(['checkout', 'return_order', 'transfer', 'disposal', 'scan']),
  priority: z.enum(['normal', 'high', 'urgent']).default('normal'),
  expectedReturnAt: z.string().min(1).optional(),
  notes: z.string().optional(),
  items: z.array(orderItemSchema).min(1, 'Zlecenie musi zawierać co najmniej jedną pozycję'),
}).superRefine((value, context) => {
  if (value.orderType === 'scan' && value.items.some((item) => item.boxId || item.boxNumber || item.hrFolderId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Zlecenie skanu może zawierać tylko teczki, pozycje spisu lub dokumenty' });
  }
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
  status: z.enum(['pending', 'picked']),
});

export const deliverOrderSchema = z.object({
  proof: z.object({
    recipientName: z.string().trim().min(2).max(120),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
    accuracyMeters: z.number().finite().min(0).max(100000).optional(),
  }).superRefine((proof, context) => {
    const location = [proof.latitude, proof.longitude, proof.accuracyMeters];
    if (location.some((value) => value !== undefined) && location.some((value) => value === undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Podaj komplet współrzędnych oraz dokładność', path: ['latitude'] });
    }
  }).optional(),
});

export const createCustodyEventSchema = z.object({
  boxId: z.string().uuid(),
  eventType: z.enum(['handover', 'receipt', 'return_event', 'transfer']),
  toUserId: z.string().uuid().optional(),
  toLocationId: z.string().uuid('Wybierz lokalizację docelową z listy').optional(),
  notes: z.string().optional(),
  signatureData: z.string().optional(),
});
