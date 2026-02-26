import { z } from 'zod';

export const createFolderSchema = z.object({
  boxId: z.string().uuid('Nieprawidłowe ID kartonu'),
  title: z.string().min(1, 'Tytuł jest wymagany').max(500),
  docType: z.string().max(100).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().optional(),
  customFields: z.record(z.unknown()).optional(),
});

export const updateFolderSchema = createFolderSchema.omit({ boxId: true }).partial();

export const reorderFoldersSchema = z.object({
  folderIds: z.array(z.string().uuid()).min(1, 'Lista teczek jest wymagana'),
});
