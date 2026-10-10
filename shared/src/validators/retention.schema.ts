import { z } from 'zod';
import { DOC_TYPES } from '../constants/statuses';

const optionalDocTypeSchema = z.enum(DOC_TYPES).optional();

const retentionRuleSchema = z.object({
  conditionField: z.string().min(1),
  conditionOperator: z.string().min(1),
  conditionValue: z.string().min(1),
  action: z.enum(['review', 'dispose', 'archive']).default('review'),
  notifyBeforeDays: z.number().int().min(0).default(30),
});

export const createRetentionPolicySchema = z.object({
  scope: z.enum(['global', 'tenant']).default('tenant'),
  name: z.string().min(1, 'Nazwa jest wymagana').max(200),
  docType: optionalDocTypeSchema,
  retentionYears: z.number().int().min(1, 'Okres retencji musi wynosić min. 1 rok').max(100),
  retentionTrigger: z.enum(['end_date', 'creation_date']).default('creation_date'),
  description: z.string().max(1000).optional(),
  isActive: z.boolean().default(true),
  rules: z.array(retentionRuleSchema).optional(),
});

export const updateRetentionPolicySchema = createRetentionPolicySchema.omit({ rules: true, scope: true }).partial();

export const initiateDisposalSchema = z.object({
  boxIds: z.array(z.string().uuid()).min(1, 'Wymagane co najmniej jedno ID kartonu'),
  notes: z.string().max(1000).optional(),
});

export const approveDisposalSchema = z.object({
  boxIds: z.array(z.string().uuid()).min(1, 'Wymagane co najmniej jedno ID kartonu'),
  notes: z.string().trim().max(1000).optional(),
});

export const rejectDisposalSchema = z.object({
  boxIds: z.array(z.string().uuid()).min(1, 'Wymagane co najmniej jedno ID kartonu'),
  reason: z.string().trim().min(5, 'Podaj powód odrzucenia').max(1000),
});

export const completeDisposalSchema = z.object({
  boxIds: z.array(z.string().uuid()).min(1, 'Wymagane co najmniej jedno ID kartonu').max(500, 'Jednorazowo można zakończyć brakowanie maksymalnie 500 kartonów'),
  protocolReference: z.string().trim().min(3, 'Podaj numer protokołu').max(200),
  confirmed: z.literal(true),
});
