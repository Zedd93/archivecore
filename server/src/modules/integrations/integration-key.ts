import { createHash, randomBytes } from 'crypto';

const KEY_PATTERN = /^ac_live_[a-f0-9]{64}$/;

export function createIntegrationSecret() {
  const secret = `ac_live_${randomBytes(32).toString('hex')}`;
  return { secret, keyHash: hashIntegrationSecret(secret), keyPrefix: `${secret.slice(0, 16)}...` };
}

export function hashIntegrationSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

export function isIntegrationSecret(secret: string) {
  return KEY_PATTERN.test(secret);
}
