import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { prisma } from '~/utils/prisma';

const WYZIE_PROVIDER = 'wyzie';
const ENCRYPTION_VERSION = 'v1';
const LEGACY_WYZIE_KEY = (userId: string) => `user:wyzie_key:${userId}`;

function getEncryptionKey() {
  const runtimeConfig = useRuntimeConfig();
  const secret = String(runtimeConfig.cryptoSecret || process.env.CRYPTO_SECRET || '').trim();
  if (!secret) {
    throw new Error('CRYPTO_SECRET environment variable is not set');
  }

  return createHash('sha256').update(`framezoo:provider-credentials:${secret}`).digest();
}

export function encryptProviderCredential(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

export function decryptProviderCredential(encoded: string) {
  const [version, ivEncoded, ciphertextEncoded, tagEncoded] = encoded.split('.');
  if (version !== ENCRYPTION_VERSION || !ivEncoded || !ciphertextEncoded || !tagEncoded) {
    throw new Error('Invalid provider credential');
  }

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
}

export async function getUserProviderCredential(userId: string, provider = WYZIE_PROVIDER) {
  const stored = await prisma.user_provider_credentials.findUnique({
    where: {
      user_id_provider: {
        user_id: userId,
        provider,
      },
    },
    select: { secret_ciphertext: true },
  });

  if (stored?.secret_ciphertext) {
    return decryptProviderCredential(stored.secret_ciphertext);
  }

  // Migrate the old Redis-backed Wyzie key on first access.
  if (provider !== WYZIE_PROVIDER) return null;
  const storage = useStorage('cache');
  const legacy = await storage.getItem<string>(LEGACY_WYZIE_KEY(userId));
  if (typeof legacy !== 'string' || !legacy.trim()) return null;

  const value = legacy.trim().slice(0, 256);
  await prisma.user_provider_credentials.upsert({
    where: {
      user_id_provider: {
        user_id: userId,
        provider,
      },
    },
    update: { secret_ciphertext: encryptProviderCredential(value) },
    create: {
      user_id: userId,
      provider,
      secret_ciphertext: encryptProviderCredential(value),
    },
  });
  await storage.removeItem(LEGACY_WYZIE_KEY(userId));
  return value;
}

export async function setUserProviderCredential(
  userId: string,
  value: string,
  provider = WYZIE_PROVIDER
) {
  const storage = useStorage('cache');
  const legacyKey = LEGACY_WYZIE_KEY(userId);
  const trimmed = value
    .trim()
    .replace(/[\r\n\t]/g, '')
    .slice(0, 256);

  if (!trimmed) {
    await prisma.user_provider_credentials.deleteMany({
      where: { user_id: userId, provider },
    });
    await storage.removeItem(legacyKey);
    return false;
  }

  await prisma.user_provider_credentials.upsert({
    where: {
      user_id_provider: {
        user_id: userId,
        provider,
      },
    },
    update: { secret_ciphertext: encryptProviderCredential(trimmed) },
    create: {
      user_id: userId,
      provider,
      secret_ciphertext: encryptProviderCredential(trimmed),
    },
  });
  await storage.removeItem(legacyKey);
  return true;
}
