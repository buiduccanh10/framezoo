import { prisma } from './prisma';
import { hashEmailIndex } from './piiCrypto';

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export async function findUserByEmail(email: string) {
  const normalized = normalizeEmail(email);
  return prisma.users.findUnique({
    where: { email_hash: hashEmailIndex(normalized) },
  });
}

export async function findUserByAccountIdentifier(identifier: string, publicKey?: string) {
  const normalizedIdentifier = identifier.trim();

  return prisma.users.findFirst({
    where: {
      OR: [
        { nickname: normalizedIdentifier },
        { email_hash: hashEmailIndex(normalizedIdentifier) },
        ...(publicKey ? [{ public_key: publicKey }] : []),
      ],
    },
  });
}
