import { z } from 'zod';

const ORDER_TYPES = ['checkout', 'return_order', 'transfer', 'disposal', 'scan'] as const;
const PRIORITIES = ['normal', 'high', 'urgent'] as const;

export const updateTenantSlaSchema = z.object({
  policies: z.array(z.object({
    orderType: z.enum(ORDER_TYPES),
    priority: z.enum(PRIORITIES),
    hours: z.number().int().min(1).max(240),
  })).length(ORDER_TYPES.length * PRIORITIES.length),
}).superRefine(({ policies }, context) => {
  const keys = policies.map((policy) => `${policy.orderType}:${policy.priority}`);
  if (new Set(keys).size !== ORDER_TYPES.length * PRIORITIES.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['policies'], message: 'Podaj dokładnie jeden czas SLA dla każdego rodzaju zlecenia i priorytetu' });
  }
});

export const updateTenantSlaTargetSchema = z.object({
  slaTargetPercent: z.number().int().min(1).max(100),
});
