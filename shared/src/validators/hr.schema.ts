import { z } from 'zod';

function validatePeselChecksum(pesel: string): boolean {
  if (!/^\d{11}$/.test(pesel)) return false;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const digits = pesel.split('').map(Number);
  const sum = weights.reduce((acc, w, i) => acc + w * digits[i], 0);
  return (10 - (sum % 10)) % 10 === digits[10];
}

export const createHRFolderSchema = z.object({
  employeeFirstName: z.string().min(1, 'Imię jest wymagane').max(100),
  employeeLastName: z.string().min(1, 'Nazwisko jest wymagane').max(100),
  employeePesel: z.string().length(11, 'PESEL musi mieć 11 znaków').regex(/^\d{11}$/, 'PESEL musi składać się z cyfr').refine(validatePeselChecksum, 'Invalid PESEL checksum'),
  employeeIdNumber: z.string().max(50).optional(),
  employmentStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  employmentEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  employmentStatus: z.enum(['active', 'terminated', 'retired', 'deceased']).default('active'),
  department: z.string().max(200).optional(),
  position: z.string().max(200).optional(),
  retentionPeriod: z.enum(['ten_years', 'fifty_years']).default('ten_years'),
  storageForm: z.enum(['paper', 'digital', 'hybrid']).default('paper'),
  boxId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

export const createHRDocumentSchema = z.object({
  title: z.string().min(1, 'Tytuł jest wymagany').max(500),
  docType: z.string().max(100).optional(),
  docDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pageCount: z.number().int().min(0).optional(),
  notes: z.string().optional(),
  attachmentId: z.string().uuid().optional(),
});

export const updateHRFolderSchema = createHRFolderSchema.partial();

export const litigationHoldSchema = z.object({
  litigationHold: z.boolean(),
  notes: z.string().optional(),
});

export const searchByPeselSchema = z.object({
  pesel: z.string().length(11).regex(/^\d{11}$/),
});
