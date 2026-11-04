import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { EmailTemplate } from './email';

export type EmailOutboxPayload = {
  to: string;
  template: EmailTemplate;
  code: string;
};

const getEncryptionKey = (): Buffer => {
  const secret =
    process.env.EMAIL_OUTBOX_SECRET || process.env.OTP_SECRET || process.env.CRYPTO_SECRET;
  if (!secret) throw new Error('EMAIL_OUTBOX_SECRET, OTP_SECRET, or CRYPTO_SECRET is required');
  return createHash('sha256').update(secret).digest();
};

export const encryptEmailPayload = (payload: EmailOutboxPayload): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map(value => value.toString('base64url')).join('.');
};

export const decryptEmailPayload = (encoded: string): EmailOutboxPayload => {
  const [ivEncoded, authTagEncoded, ciphertextEncoded] = encoded.split('.');
  if (!ivEncoded || !authTagEncoded || !ciphertextEncoded) {
    throw new Error('Invalid email outbox payload');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivEncoded, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(authTagEncoded, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  const parsed = JSON.parse(plaintext) as Partial<EmailOutboxPayload>;

  if (
    typeof parsed.to !== 'string' ||
    typeof parsed.template !== 'string' ||
    typeof parsed.code !== 'string'
  ) {
    throw new Error('Invalid email outbox payload fields');
  }

  return parsed as EmailOutboxPayload;
};
