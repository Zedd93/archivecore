import { z } from 'zod';

export const createLocationSchema = z.object({
  parentId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
  type: z.enum(['warehouse', 'zone', 'rack', 'shelf', 'slot'], { required_error: 'Typ lokalizacji jest wymagany' }),
  code: z.string().min(1, 'Kod jest wymagany').max(50),
  name: z.string().min(1, 'Nazwa jest wymagana').max(200),
  description: z.string().max(500).optional(),
  capacity: z.number().int().min(0).optional(),
});

export const updateLocationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  capacity: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
