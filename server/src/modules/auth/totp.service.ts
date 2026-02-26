import speakeasy from 'speakeasy';
import crypto from 'crypto';

export function generateTotpSecret(email: string) {
  const secret = speakeasy.generateSecret({
    name: `ArchiveCore (${email})`,
    issuer: 'ArchiveCore',
    length: 32,
  });
  return {
    secret: secret.base32,
    otpauthUrl: secret.otpauth_url || '',
  };
}

export function verifyTotpToken(secret: string, token: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 1,
  });
}

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  }
  return codes;
}
