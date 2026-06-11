import { z } from 'zod';

export const createLocationSchema = z.object({
  parentId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
  type: z.enum(['warehouse', 'zone', 'rack', 'shelf', 'level', 'slot'], { required_error: 'Typ lokalizacji jest wymagany' }),
  code: z.string().min(1, 'Kod jest wymagany').max(50),
  name: z.string().min(1, 'Nazwa jest wymagana').max(200),
  address: z.string().max(1000).optional(),
  description: z.string().max(500).optional(),
  capacity: z.number().int().min(0).optional(),
});

export const updateLocationSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  type: z.enum(['warehouse', 'zone', 'rack', 'shelf', 'level', 'slot']).optional(),
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(200).optional(),
  address: z.string().max(1000).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  capacity: z.number().int().min(0).nullable().optional(),
  isActive: z.boolean().optional(),
});
