import { prisma } from '~/utils/prisma';

const DEFAULT_GUEST_RETENTION_DAYS = 30;

export default defineTask({
  meta: {
    name: 'jobs:cleanup-guests',
    description: 'Remove expired anonymous guest records',
  },
  async run() {
    const parsedDays = Number(process.env.GUEST_RETENTION_DAYS || DEFAULT_GUEST_RETENTION_DAYS);
    const retentionDays =
      Number.isFinite(parsedDays) && parsedDays > 0
        ? Math.floor(parsedDays)
        : DEFAULT_GUEST_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60_000);

    const deleted = await prisma.guests.deleteMany({
      where: { last_seen_at: { lt: cutoff } },
    });

    return { result: 'success', deletedCount: deleted.count };
  },
});
