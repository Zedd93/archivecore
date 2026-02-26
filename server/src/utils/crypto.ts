import crypto from 'crypto';
import { config } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export function encryptAES256(text: string): string {
  const key = Buffer.from(config.encryption.key.padEnd(32, '0').substring(0, 32), 'utf-8');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

export function decryptAES256(encryptedData: string): string {
  const key = Buffer.from(config.encryption.key.padEnd(32, '0').substring(0, 32), 'utf-8');
  const parts = encryptedData.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted data format');
  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function hmacSha256(text: string): string {
  const key = config.encryption.key;
  return crypto.createHmac('sha256', key).update(text).digest('hex');
}

export function hashPassword(password: string): string {
  // Note: in actual use, bcrypt is used (see auth.service.ts)
  // This is a fallback utility
  return crypto.createHash('sha256').update(password).digest('hex');
}
