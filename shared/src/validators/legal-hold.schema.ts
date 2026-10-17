import { z } from 'zod';

export const documentationLegalHoldSchema = z.object({
  hold: z.boolean(),
  reason: z.string().trim().min(5, 'Podaj powód (co najmniej 5 znaków)').max(1000),
});
