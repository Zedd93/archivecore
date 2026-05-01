import { describe, it, expect } from 'vitest';
import { loginSchema, changePasswordSchema } from '../user.schema';

describe('loginSchema', () => {
  it('accepts valid credentials', () => {
    const r = loginSchema.safeParse({ email: 'a@b.pl', password: 'x' });
    expect(r.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const r = loginSchema.safeParse({ email: 'not-an-email', password: 'x' });
    expect(r.success).toBe(false);
  });

  it('rejects empty password', () => {
    const r = loginSchema.safeParse({ email: 'a@b.pl', password: '' });
    expect(r.success).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(loginSchema.safeParse({ email: 'a@b.pl' }).success).toBe(false);
    expect(loginSchema.safeParse({ password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({}).success).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it('rejects new password shorter than 12 chars', () => {
    const r = changePasswordSchema.safeParse({ oldPassword: 'x', newPassword: 'short' });
    expect(r.success).toBe(false);
  });

  it('accepts a 12+ char new password', () => {
    const r = changePasswordSchema.safeParse({
      oldPassword: 'old',
      newPassword: 'aLongEnoughPassword123!',
    });
    expect(r.success).toBe(true);
  });
});
