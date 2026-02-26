import { z } from 'zod';

export const createDocumentSchema = z.object({
  boxId: z.string().uuid('Nieprawidłowe ID kartonu'),
  folderId: z.string().uuid().optional(),
  title: z.string().min(1, 'Tytuł jest wymagany').max(500),
  docType: z.string().max(100).optional(),
  docDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pageCount: z.number().int().min(0).optional(),
  description: z.string().optional(),
  confidentiality: z.enum(['normal', 'confidential', 'secret']).default('normal'),
  customFields: z.record(z.unknown()).optional(),
});

export const updateDocumentSchema = createDocumentSchema.omit({ boxId: true, folderId: true }).partial();
