import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import type { Job } from 'bullmq';
import type { EmailJob } from './utils/emailQueue';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const { Worker } = await import('bullmq');
const { prisma } = await import('./utils/prisma');
const { sendEmail } = await import('./utils/email');
const { decryptEmailPayload } = await import('./utils/emailOutbox');
const { EMAIL_JOB_ATTEMPTS, EMAIL_QUEUE_NAME, enqueueEmailDeadLetter } =
  await import('./utils/emailQueue');

const redisUrl =
  process.env.REDIS_QUEUE_URL ||
  process.env.REDIS_URL ||
  `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`;
const connection = {
  url: redisUrl,
  maxRetriesPerRequest: null,
  connectionName: 'framezoo-email-worker',
};

const concurrency = Math.max(1, Number(process.env.EMAIL_WORKER_CONCURRENCY || 5));
const retryDelay = (attempt: number) =>
  Math.min(10 * 60_000, 5_000 * 2 ** Math.max(0, attempt - 1)) + Math.floor(Math.random() * 1_000);

const isTransientMailError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return true;
  const value = error as { code?: string; responseCode?: number; statusCode?: number };
  if (value.statusCode === 429 || (value.statusCode && value.statusCode >= 500)) return true;
  if (value.responseCode && value.responseCode >= 500) return false;
  if (value.responseCode && value.responseCode >= 400) {
    return [421, 450, 451, 452].includes(value.responseCode);
  }
  return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ESOCKET'].includes(value.code || '');
};

const processJob = async (job: Job<EmailJob>) => {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 10 * 60_000);
  const claimed = await prisma.email_outbox.updateMany({
    where: {
      id: job.data.outboxId,
      OR: [{ status: 'pending' }, { status: 'processing', locked_at: { lt: staleBefore } }],
    },
    data: {
      status: 'processing',
      locked_at: now,
      attempts: { increment: 1 },
    },
  });

  if (claimed.count !== 1) return;

  const outbox = await prisma.email_outbox.findUnique({ where: { id: job.data.outboxId } });
  if (!outbox) return;

  if (outbox.challenge_id) {
    const challenge = await prisma.email_otp_challenges.findUnique({
      where: { id: outbox.challenge_id },
      select: { expires_at: true },
    });
    if (!challenge || challenge.expires_at <= new Date()) {
      await prisma.email_outbox.updateMany({
        where: { id: outbox.id, status: 'processing' },
        data: { status: 'failed', locked_at: null, last_error: 'OTP expired before delivery' },
      });
      await enqueueEmailDeadLetter(outbox.id, 'OTP expired before delivery');
      return;
    }
  }

  try {
    const payload = decryptEmailPayload(outbox.payload_ciphertext);
    const result = await sendEmail(payload);
    await prisma.email_outbox.updateMany({
      where: { id: outbox.id, status: 'processing' },
      data: {
        status: 'sent',
        sent_at: new Date(),
        locked_at: null,
        provider_message_id: result.messageId,
        last_error: null,
      },
    });
  } catch (error) {
    const attempts = outbox.attempts;
    const transient = isTransientMailError(error);
    const exhausted = attempts >= EMAIL_JOB_ATTEMPTS;
    const message = error instanceof Error ? error.message.slice(0, 1_000) : String(error);

    if (transient && !exhausted) {
      await prisma.email_outbox.updateMany({
        where: { id: outbox.id, status: 'processing' },
        data: {
          status: 'pending',
          locked_at: null,
          available_at: new Date(Date.now() + retryDelay(attempts)),
          last_error: message,
        },
      });
      throw error;
    }

    await prisma.email_outbox.updateMany({
      where: { id: outbox.id, status: 'processing' },
      data: { status: 'failed', locked_at: null, last_error: message },
    });
    await enqueueEmailDeadLetter(outbox.id, message);
  }
};

const worker = new Worker<EmailJob>(EMAIL_QUEUE_NAME, processJob, {
  connection,
  concurrency,
});

worker.on('error', error => {
  console.error('[email-worker] worker error', error instanceof Error ? error.message : error);
});

worker.on('failed', (job, error) => {
  console.error('[email-worker] job failed', {
    outboxId: job?.data.outboxId,
    error: error instanceof Error ? error.message : String(error),
  });
});

const shutdown = async () => {
  await worker.close();
  await prisma.$disconnect();
};

process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));

console.log(`[email-worker] listening concurrency=${concurrency}`);
