import { defineNitroPlugin } from '#imports';
import { prisma } from '../utils/prisma';
import { scopedLogger } from '../utils/logger';
import { normalizeEmail } from '../utils/accountIdentifier';
import {
  decryptPii,
  encryptPii,
  hashContactIndex,
  hashEmailIndex,
  isEncryptedPii,
} from '../utils/piiCrypto';

const log = scopedLogger('pii-backfill');
const BATCH_SIZE = 100;

async function backfillUsers(): Promise<number> {
  let updated = 0;
  while (true) {
    const rows = await prisma.users.findMany({
      where: {
        email: { not: null },
        OR: [{ email_hash: null }, { NOT: { email: { startsWith: 'v1.' } } }],
      },
      select: { id: true, email: true },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      if (!row.email) continue;
      const plain = normalizeEmail(decryptPii(row.email));
      const emailHash = hashEmailIndex(plain);
      const encrypted = isEncryptedPii(row.email) ? row.email : encryptPii(plain);
      try {
        await prisma.users.update({
          where: { id: row.id },
          data: { email: encrypted, email_hash: emailHash },
        });
        updated += 1;
      } catch (error) {
        log.warn('Failed to backfill user email', {
          userId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (rows.length < BATCH_SIZE) break;
  }
  return updated;
}

async function backfillFeedbacks(): Promise<number> {
  let updated = 0;
  while (true) {
    const rows = await prisma.feedbacks.findMany({
      where: {
        contact: { not: null },
        OR: [{ contact_hash: null }, { NOT: { contact: { startsWith: 'v1.' } } }],
      },
      select: { id: true, contact: true },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      if (!row.contact) continue;
      const plain = decryptPii(row.contact);
      const contactHash = hashContactIndex(plain);
      const encrypted = isEncryptedPii(row.contact) ? row.contact : encryptPii(plain);
      await prisma.feedbacks.update({
        where: { id: row.id },
        data: { contact: encrypted, contact_hash: contactHash },
      });
      updated += 1;
    }
    if (rows.length < BATCH_SIZE) break;
  }
  return updated;
}

async function backfillOtpChallenges(): Promise<number> {
  let updated = 0;
  while (true) {
    const rows = await prisma.email_otp_challenges.findMany({
      where: {
        OR: [{ email_hash: null }, { NOT: { email: { startsWith: 'v1.' } } }],
      },
      select: { id: true, email: true, payload: true },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      const plain = normalizeEmail(decryptPii(row.email));
      const emailHash = hashEmailIndex(plain);
      const encryptedEmail = isEncryptedPii(row.email) ? row.email : encryptPii(plain);

      let nextPayload: Record<string, unknown> | undefined;
      if (row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)) {
        const obj = row.payload as Record<string, unknown>;
        if (typeof obj.newEmail === 'string' && !isEncryptedPii(obj.newEmail)) {
          nextPayload = { ...obj, newEmail: encryptPii(normalizeEmail(obj.newEmail)) };
        }
      }

      await prisma.email_otp_challenges.update({
        where: { id: row.id },
        data: {
          email: encryptedEmail,
          email_hash: emailHash,
          ...(nextPayload ? { payload: nextPayload as never } : {}),
        },
      });
      updated += 1;
    }
    if (rows.length < BATCH_SIZE) break;
  }
  return updated;
}

export default defineNitroPlugin(async () => {
  if (!process.env.PII_ENCRYPTION_KEY?.trim() && !process.env.CRYPTO_SECRET?.trim()) {
    return;
  }

  try {
    const [usersCount, feedbacksCount, otpCount] = await Promise.all([
      backfillUsers(),
      backfillFeedbacks(),
      backfillOtpChallenges(),
    ]);
    if (usersCount || feedbacksCount || otpCount) {
      log.info('Encrypted legacy PII records', {
        usersCount,
        feedbacksCount,
        otpCount,
      });
    }
  } catch (error) {
    log.error('Failed to backfill legacy PII records', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
