import { z } from 'zod';

export const createTenantSchema = z.object({
  name: z.string().min(1, 'Nazwa jest wymagana').max(200),
  shortCode: z.string().min(3, 'Kod musi mieć min. 3 znaki').max(6, 'Kod może mieć max. 6 znaków').regex(/^[A-Z0-9]+$/, 'Kod może zawierać tylko wielkie litery i cyfry'),
  nip: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  contactPerson: z.string().max(200).optional(),
  contactEmail: z.string().email('Nieprawidłowy email').optional(),
  contactPhone: z.string().max(20).optional(),
  isActive: z.boolean().default(true),
  configJson: z.record(z.unknown()).optional(),
});

export const updateTenantSchema = createTenantSchema.omit({ shortCode: true }).partial();
