import { randomUUID } from 'crypto';
import { scopedLogger } from '~/utils/logger';
import { shouldSaveProgress } from '~/utils/progress';

const log = scopedLogger('sync-progress');

interface ProgressQueueItem {
  tmdbId: string;
  userId: string;
  seasonId: string | null;
  episodeId: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  duration: number;
  watched: number;
  meta: {
    type?: string;
    [key: string]: unknown;
  };
  updatedAt: string | number;
}

type PrismaProgressMeta = Parameters<typeof prisma.progress_items.create>[0]['data']['meta'];

export default defineTask({
  meta: {
    name: 'jobs:sync-progress',
    description: 'Bulk sync progress from Redis queue to PostgreSQL',
  },
  async run() {
    try {
      const storage = useStorage('cache');
      const keys = await storage.getKeys('progress_queue:');

      if (keys.length === 0) {
        return { result: 'success', synced: 0 };
      }

      const itemsToProcess: Array<{ key: string; data: ProgressQueueItem }> = [];
      for (const key of keys) {
        const data = await storage.getItem<ProgressQueueItem>(key);
        if (data) {
          itemsToProcess.push({ key, data });
        }
      }

      let syncedCount = 0;

      for (const { key, data } of itemsToProcess) {
        const {
          tmdbId,
          userId,
          seasonId,
          episodeId,
          seasonNumber,
          episodeNumber,
          duration,
          watched,
          meta,
          updatedAt,
        } = data;
        const normSeasonId = seasonId === 'none' ? null : seasonId;
        const normEpisodeId = episodeId === 'none' ? null : episodeId;

        let userExists: { id: string } | null = null;
        if (userId) {
          userExists = await prisma.users.findUnique({
            where: { id: userId },
            select: { id: true },
          });
        }
        if (!userExists) {
          await storage.removeItem(key);
          continue;
        }

        const now = new Date(updatedAt);

        const existing = await prisma.progress_items.findUnique({
          where: {
            tmdb_id_user_id_season_id_episode_id: {
              tmdb_id: tmdbId,
              user_id: userId,
              season_id: normSeasonId,
              episode_id: normEpisodeId,
            },
          },
        });

        const metaType = meta.type || 'show';
        const saveArgs = [
          userId,
          tmdbId,
          metaType,
          duration,
          watched,
          normSeasonId,
          normEpisodeId,
        ] as const;
        const shouldSave = await shouldSaveProgress(...saveArgs);

        if (shouldSave) {
          const dbData = {
            duration: BigInt(duration),
            watched: BigInt(watched),
            meta: meta as PrismaProgressMeta,
            updated_at: now,
            ...(seasonNumber !== undefined ? { season_number: seasonNumber ?? null } : {}),
            ...(episodeNumber !== undefined ? { episode_number: episodeNumber ?? null } : {}),
          };

          if (existing) {
            if (now.getTime() >= new Date(existing.updated_at).getTime()) {
              await prisma.progress_items.update({ where: { id: existing.id }, data: dbData });
            }
          } else {
            await prisma.progress_items.create({
              data: {
                id: randomUUID(),
                tmdb_id: tmdbId,
                user_id: userId,
                season_id: normSeasonId,
                episode_id: normEpisodeId,
                season_number: seasonNumber ?? null,
                episode_number: episodeNumber ?? null,
                ...dbData,
              },
            });
          }
          syncedCount++;
        }

        // Remove key only after we verified it was saved (or decided it should be ignored)
        await storage.removeItem(key);
      }

      log.info(`Successfully processed ${keys.length} items, synced ${syncedCount} to DB.`);
      return { result: 'success', processed: keys.length, synced: syncedCount };
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn('[sync-progress] Skipping sync: Redis cache is unavailable:', reason);
      return { result: 'skipped', reason: 'Redis unavailable' };
    }
  },
});
