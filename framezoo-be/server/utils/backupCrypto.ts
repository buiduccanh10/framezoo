import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const BACKUP_MAGIC = Buffer.from('FZBK1', 'ascii');
const BACKUP_IV_BYTES = 12;
const BACKUP_TAG_BYTES = 16;

const getBackupKey = (): Buffer => {
  const secret = process.env.BACKUP_ENCRYPTION_KEY?.trim() || process.env.CRYPTO_SECRET?.trim();
  if (!secret) {
    throw new Error('BACKUP_ENCRYPTION_KEY or CRYPTO_SECRET is required for backup encryption');
  }
  return createHmac('sha256', secret).update('framezoo:backup:enc:v1').digest();
};

export const encryptBackupBuffer = (plaintext: Buffer): Buffer => {
  const iv = randomBytes(BACKUP_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', getBackupKey(), iv);
  cipher.setAAD(BACKUP_MAGIC);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([BACKUP_MAGIC, iv, tag, ciphertext]);
};

export const decryptBackupBuffer = (encrypted: Buffer): Buffer => {
  const headerBytes = BACKUP_MAGIC.length + BACKUP_IV_BYTES + BACKUP_TAG_BYTES;
  if (
    encrypted.length < headerBytes ||
    !encrypted.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)
  ) {
    throw new Error('Invalid encrypted backup format');
  }

  const ivStart = BACKUP_MAGIC.length;
  const tagStart = ivStart + BACKUP_IV_BYTES;
  const iv = encrypted.subarray(ivStart, tagStart);
  const tag = encrypted.subarray(tagStart, headerBytes);
  const ciphertext = encrypted.subarray(headerBytes);

  const decipher = createDecipheriv('aes-256-gcm', getBackupKey(), iv);
  decipher.setAAD(BACKUP_MAGIC);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};
