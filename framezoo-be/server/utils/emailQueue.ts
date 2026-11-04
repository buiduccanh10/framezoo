import { Queue } from 'bullmq';

export const EMAIL_QUEUE_NAME = 'email-otp';
export const EMAIL_DLQ_NAME = 'email-otp-dlq';
export const EMAIL_JOB_ATTEMPTS = 5;

export type EmailJob = {
  outboxId: string;
};

const redisUrl = () =>
  process.env.REDIS_QUEUE_URL ||
  process.env.REDIS_URL ||
  `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`;

const createConnection = () => ({
  url: redisUrl(),
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  connectionName: 'framezoo-email-queue',
});

let emailQueue: Queue<EmailJob, unknown, 'send', EmailJob> | null = null;
let deadLetterQueue: Queue<
  EmailJob & { reason: string },
  unknown,
  'failed',
  EmailJob & { reason: string }
> | null = null;

export const getEmailQueue = (): Queue<EmailJob> => {
  if (!emailQueue) {
    emailQueue = new Queue<EmailJob, unknown, 'send', EmailJob>(EMAIL_QUEUE_NAME, {
      connection: createConnection(),
      defaultJobOptions: {
        attempts: EMAIL_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
        removeOnFail: false,
      },
    });
  }
  return emailQueue;
};

export const getEmailDeadLetterQueue = (): Queue<EmailJob & { reason: string }> => {
  if (!deadLetterQueue) {
    deadLetterQueue = new Queue<
      EmailJob & { reason: string },
      unknown,
      'failed',
      EmailJob & { reason: string }
    >(EMAIL_DLQ_NAME, {
      connection: createConnection(),
      defaultJobOptions: {
        removeOnComplete: { age: 7 * 24 * 60 * 60, count: 5_000 },
        removeOnFail: false,
      },
    });
  }
  return deadLetterQueue;
};

export async function enqueueEmailOutbox(outboxId: string): Promise<void> {
  await getEmailQueue().add('send', { outboxId }, { jobId: outboxId });
}

export async function enqueueEmailDeadLetter(outboxId: string, reason: string): Promise<void> {
  await getEmailDeadLetterQueue().add(
    'failed',
    { outboxId, reason },
    { jobId: `${outboxId}:${Date.now()}` }
  );
}
