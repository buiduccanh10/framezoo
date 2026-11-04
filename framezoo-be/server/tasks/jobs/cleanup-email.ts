import { prisma } from '~/utils/prisma';

export default defineTask({
  meta: {
    name: 'jobs:cleanup-email',
    description: 'Remove expired email verification records',
  },
  async run() {
    const now = new Date();
    const retentionCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60_000);

    // ponytail: daily scans suit a small OTP table; index expires_at if cleanup slows at scale.
    await prisma.otp_idempotency_keys.deleteMany({
      where: { expires_at: { lt: now } },
    });
    await prisma.email_outbox.deleteMany({
      where: { status: { in: ['sent', 'failed'] }, created_at: { lt: retentionCutoff } },
    });
    await prisma.email_otp_challenges.deleteMany({
      where: { expires_at: { lt: retentionCutoff } },
    });

    return { result: 'success' };
  },
});
