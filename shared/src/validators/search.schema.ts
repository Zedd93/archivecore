import { z } from 'zod';

export const searchQuerySchema = z.object({
  q: z.string().min(2, 'Zapytanie musi mieć min. 2 znaki').max(200),
  types: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
