import { z } from 'zod';
import { DOC_TYPES } from '../constants/statuses';

const optionalDocTypeSchema = z.enum(DOC_TYPES).optional();

export function validatePeselChecksum(pesel: string): boolean {
  if (!/^\d{11}$/.test(pesel)) return false;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const digits = pesel.split('').map(Number);
  const sum = weights.reduce((acc, w, i) => acc + w * digits[i], 0);
  return (10 - (sum % 10)) % 10 === digits[10];
}

export const peselSchema = z.string()
  .length(11, 'PESEL musi mieć 11 znaków')
  .regex(/^\d{11}$/, 'PESEL musi składać się z cyfr')
  .refine(validatePeselChecksum, 'Nieprawidłowy numer PESEL');

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Nieprawidłowa data');

const hrFolderFields = z.object({
  employeeFirstName: z.string().min(1, 'Imię jest wymagane').max(100),
  employeeLastName: z.string().min(1, 'Nazwisko jest wymagane').max(100),
  employeePesel: peselSchema,
  employeeIdNumber: z.string().max(50).optional(),
  employmentStart: dateField.optional(),
  employmentEnd: dateField.optional(),
  employmentStatus: z.enum(['active', 'terminated', 'retired', 'deceased']).default('active'),
  department: z.string().max(200).optional(),
  position: z.string().max(200).optional(),
  riaStatus: z.enum(['unknown', 'not_submitted', 'submitted']).default('unknown'),
  riaSubmittedAt: dateField.optional(),
  retentionReviewRequired: z.boolean().default(false),
  storageForm: z.enum(['paper', 'digital', 'hybrid']).default('paper'),
  boxId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

export const createHRFolderSchema = hrFolderFields.superRefine((data, ctx) => {
  if (data.employmentStart && data.employmentEnd && data.employmentEnd < data.employmentStart) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['employmentEnd'], message: 'Data zakończenia pracy nie może poprzedzać daty rozpoczęcia' });
  }
  const startYear = data.employmentStart ? Number(data.employmentStart.slice(0, 4)) : null;
  const transitional = startYear !== null && startYear >= 1999 && startYear < 2019;
  if (data.riaStatus !== 'unknown' && !transitional) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['riaStatus'], message: 'Raport ZUS RIA dotyczy zatrudnienia rozpoczętego w latach 1999–2018' });
  }
  if (data.riaStatus === 'submitted' && !data.riaSubmittedAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['riaSubmittedAt'], message: 'Podaj datę złożenia raportu ZUS RIA' });
  }
  if (data.riaSubmittedAt && (data.riaSubmittedAt < '2019-01-01' || (data.employmentEnd && data.riaSubmittedAt < data.employmentEnd))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['riaSubmittedAt'], message: 'Data ZUS RIA nie może poprzedzać 2019 r. ani zakończenia zatrudnienia' });
  }
  if (data.riaStatus !== 'submitted' && data.riaSubmittedAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['riaSubmittedAt'], message: 'Data wymaga potwierdzenia złożenia raportu ZUS RIA' });
  }
});

export const createHRDocumentSchema = z.object({
  title: z.string().min(1, 'Tytuł jest wymagany').max(500),
  docType: optionalDocTypeSchema,
  docDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pageCount: z.number().int().min(0).optional(),
  notes: z.string().optional(),
  attachmentId: z.string().uuid().optional(),
});

export const updateHRFolderSchema = hrFolderFields.partial().extend({
  employmentStart: dateField.nullable().optional(),
  employmentEnd: dateField.nullable().optional(),
  riaSubmittedAt: dateField.nullable().optional(),
});

export const litigationHoldSchema = z.object({
  litigationHold: z.boolean(),
  notes: z.string().optional(),
});

export const searchByPeselSchema = z.object({
  pesel: peselSchema,
});
