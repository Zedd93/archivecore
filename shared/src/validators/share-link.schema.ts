import { z } from 'zod';

export const createShareLinkSchema = z.object({
  entityType: z.enum(['box', 'order', 'hr', 'transfer_list'], { required_error: 'Typ zasobu jest wymagany' }),
  entityId: z.string().uuid('Nieprawidłowe ID zasobu'),
  recipientEmail: z.string().email('Nieprawidłowy email').optional(),
  expiresInDays: z.number().int().min(1).max(365).default(7),
});
