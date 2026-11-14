import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const PII_VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

const deriveKey = (purpose: string, secret: string): Buffer =>
  createHmac('sha256', secret).update(purpose).digest();

const getEncryptionKey = (): Buffer => {
  const secret = process.env.PII_ENCRYPTION_KEY?.trim() || process.env.CRYPTO_SECRET?.trim();
  if (!secret) {
    throw new Error('PII_ENCRYPTION_KEY or CRYPTO_SECRET is required');
  }
  return deriveKey('framezoo:pii:enc:v1', secret);
};

const getBlindIndexKey = (): Buffer => {
  const secret =
    process.env.PII_BLIND_INDEX_KEY?.trim() ||
    process.env.PII_ENCRYPTION_KEY?.trim() ||
    process.env.CRYPTO_SECRET?.trim();
  if (!secret) {
    throw new Error('PII_BLIND_INDEX_KEY, PII_ENCRYPTION_KEY, or CRYPTO_SECRET is required');
  }
  return deriveKey('framezoo:pii:index:v1', secret);
};

const normalizeEmailAddress = (email: string): string => email.trim().toLowerCase();

export const normalizeContact = (contact: string): string => {
  const trimmed = contact.trim();
  return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed.replace(/[\s().-]/g, '');
};

export const isEncryptedPii = (value: string): boolean => {
  if (!value.startsWith(`${PII_VERSION}.`)) return false;
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  const [, ivEncoded, ciphertextEncoded, tagEncoded] = parts;
  if (!ivEncoded || ciphertextEncoded === undefined || !tagEncoded) return false;
  return (
    Buffer.from(ivEncoded, 'base64url').length === IV_BYTES &&
    Buffer.from(tagEncoded, 'base64url').length === TAG_BYTES
  );
};

export const encryptPii = (plaintext: string): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PII_VERSION,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
};

export const decryptPii = (value: string): string => {
  if (!isEncryptedPii(value)) {
    // Allow legacy plaintext rows before startup backfill finishes.
    return value;
  }

  const [, ivEncoded, ciphertextEncoded, tagEncoded] = value.split('.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivEncoded, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};

export const decryptPiiOrNull = (value: string | null | undefined): string | null =>
  typeof value === 'string' && value.length > 0 ? decryptPii(value) : null;

export const hashEmailIndex = (email: string): string =>
  createHmac('sha256', getBlindIndexKey()).update(normalizeEmailAddress(email)).digest('hex');

export const hashContactIndex = (contact: string): string =>
  createHmac('sha256', getBlindIndexKey()).update(normalizeContact(contact)).digest('hex');
