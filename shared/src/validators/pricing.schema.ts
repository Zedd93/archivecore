import { z } from 'zod';
import { PRICE_UNITS } from '../constants/pricing';

const moneySchema = z.coerce.number()
  .finite('Kwota musi być liczbą')
  .min(0, 'Kwota nie może być ujemna')
  .max(9999999999.99, 'Kwota jest zbyt wysoka');

const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Nieprawidłowa data obowiązywania')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Nieprawidłowa data obowiązywania');

export const priceListItemSchema = z.object({
  serviceCode: z.string().trim().min(1).max(50).regex(/^[a-z0-9_]+$/, 'Nieprawidłowy kod usługi'),
  serviceName: z.string().trim().min(1, 'Nazwa usługi jest wymagana').max(255),
  unit: z.enum(PRICE_UNITS),
  unitPrice: moneySchema,
  vatRate: z.coerce.number().min(0).max(100).default(23),
  minimumQuantity: moneySchema.optional().nullable(),
  isActive: z.boolean().default(true),
});

export const createPriceListSchema = z.object({
  name: z.string().trim().min(1, 'Nazwa cennika jest wymagana').max(255),
  currency: z.literal('PLN').default('PLN'),
  validFrom: dateSchema,
  minimumMonthlyFee: moneySchema.optional().nullable(),
  items: z.array(priceListItemSchema).min(1, 'Dodaj co najmniej jedną stawkę'),
}).superRefine((data, ctx) => {
  const codes = new Set<string>();
  data.items.forEach((item, index) => {
    if (codes.has(item.serviceCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', index, 'serviceCode'],
        message: 'Każda usługa może wystąpić w cenniku tylko raz',
      });
    }
    codes.add(item.serviceCode);
  });
});

export const updatePriceListSchema = createPriceListSchema;
