import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email('Nieprawidłowy adres email'),
  password: z.string().min(12, 'Hasło musi mieć minimum 12 znaków'),
  firstName: z.string().min(1, 'Imię jest wymagane').max(100),
  lastName: z.string().min(1, 'Nazwisko jest wymagane').max(100),
  phone: z.string().max(20).optional(),
  tenantId: z.string().uuid().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
});

export const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional(),
  isActive: z.boolean().optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Nieprawidłowy adres email'),
  password: z.string().min(1, 'Hasło jest wymagane'),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Stare hasło jest wymagane'),
  newPassword: z.string().min(12, 'Nowe hasło musi mieć minimum 12 znaków'),
});

export const assignRolesSchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1, 'At least one role required'),
});

export const totpVerifySchema = z.object({
  totpCode: z.string().length(6, 'Kod musi mieć 6 cyfr').regex(/^\d{6}$/),
});
