import { enqueueEmailOutbox } from '~/utils/emailQueue';
import { prisma } from '~/utils/prisma';

export default defineTask({
  meta: {
    name: 'jobs:dispatch-email-outbox',
    description: 'Dispatch pending email outbox records to the Redis queue',
  },
  async run() {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - 10 * 60_000);

    await prisma.email_outbox.updateMany({
      where: { status: 'processing', locked_at: { lt: staleBefore } },
      data: { status: 'pending', locked_at: null },
    });

    const pending = await prisma.email_outbox.findMany({
      where: { status: 'pending', available_at: { lte: now } },
      orderBy: { created_at: 'asc' },
      take: 100,
      select: { id: true },
    });

    let dispatched = 0;
    for (const item of pending) {
      try {
        await enqueueEmailOutbox(item.id);
        dispatched++;
      } catch (error) {
        console.warn('[email-outbox] queue dispatch failed', {
          outboxId: item.id,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }

    return { result: 'success', dispatched, pending: pending.length };
  },
});
