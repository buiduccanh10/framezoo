import { randomUUID } from 'crypto';
import { shouldSaveProgress } from '~/utils/progress';

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

      const itemsToProcess = [];
      for (const key of keys) {
        const data = await storage.getItem(key);
        if (data) {
          itemsToProcess.push({ key, data });
        }
      }

      let syncedCount = 0;

      for (const { key, data } of itemsToProcess) {
        const { tmdbId, userId, seasonId, episodeId, seasonNumber, episodeNumber, duration, watched, meta, updatedAt } = data as any;
        const normSeasonId = seasonId === 'none' ? null : seasonId;
        const normEpisodeId = episodeId === 'none' ? null : episodeId;

        const now = new Date(updatedAt);

        const existing = await prisma.progress_items.findUnique({
          where: { tmdb_id_user_id_season_id_episode_id: { tmdb_id: tmdbId, user_id: userId, season_id: normSeasonId, episode_id: normEpisodeId } },
        });

        const shouldSave = await shouldSaveProgress(userId, tmdbId, meta.type || 'show', duration, watched, normSeasonId, normEpisodeId);

        if (shouldSave) {
          const dbData = {
            duration: BigInt(duration),
            watched: BigInt(watched),
            meta,
            updated_at: now,
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

      console.log(`[sync-progress] Successfully processed ${keys.length} items, synced ${syncedCount} to DB.`);
      return { result: 'success', processed: keys.length, synced: syncedCount };
    } catch (err: any) {
      console.warn('[sync-progress] Skipping sync: Redis cache is unavailable or stream is not writeable.', err?.message || err);
      return { result: 'skipped', reason: 'Redis unavailable' };
    }
  }
});
