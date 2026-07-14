import { useAuth } from '~/utils/auth';

function progressIsNotStarted(duration: number, watched: number): boolean {
  // too short watch time
  if (watched < 20) return true;
  return false;
}

function progressIsCompleted(duration: number, watched: number): boolean {
  const timeFromEnd = duration - watched;
  // too close to the end, is completed
  if (timeFromEnd < 60 * 2) return true;
  return false;
}

export default defineEventHandler(async event => {
  const userId = event.context.params?.id;
  const method = event.method;

  const session = await useAuth().getCurrentSession();
  if (!session) {
    throw createError({
      statusCode: 401,
      message: 'Session not found or expired',
    });
  }

  if (session.user !== userId) {
    throw createError({
      statusCode: 403,
      message: 'Cannot access other user information',
    });
  }

  if (method === 'GET') {
    const items = await prisma.progress_items.findMany({
      where: { user_id: userId },
    });

    const results = items.map(item => ({
      id: item.id,
      tmdbId: item.tmdb_id,
      episode: {
        id: item.episode_id === '\n' ? null : (item.episode_id || null),
        number: item.episode_number || null,
      },
      season: {
        id: item.season_id === '\n' ? null : (item.season_id || null),
        number: item.season_number || null,
      },
      meta: item.meta,
      duration: item.duration.toString(),
      watched: item.watched.toString(),
      updatedAt: item.updated_at.toISOString(),
    }));

    try {
      const storage = useStorage('cache');
      const keys = await storage.getKeys(`progress_queue:${userId}:`);
      for (const key of keys) {
        const queuedData: any = await storage.getItem(key);
        if (!queuedData) continue;

        const { tmdbId, seasonId, episodeId, seasonNumber, episodeNumber, duration, watched, meta, updatedAt } = queuedData;

        const normSeasonId = seasonId === 'none' ? null : seasonId;
        const normEpisodeId = episodeId === 'none' ? null : episodeId;

        const existingIndex = results.findIndex(
          r => r.tmdbId === tmdbId && r.season.id === normSeasonId && r.episode.id === normEpisodeId
        );

        const mappedItem = {
          id: existingIndex >= 0 ? results[existingIndex].id : '',
          tmdbId,
          episode: {
            id: normEpisodeId,
            number: episodeNumber,
          },
          season: {
            id: normSeasonId,
            number: seasonNumber,
          },
          meta,
          duration: duration.toString(),
          watched: watched.toString(),
          updatedAt,
        };

        if (existingIndex >= 0) {
          // Only overwrite if queued data is newer
          if (new Date(updatedAt).getTime() > new Date(results[existingIndex].updatedAt).getTime()) {
            results[existingIndex] = mappedItem;
          }
        } else {
          results.push(mappedItem);
        }
      }
    } catch (err) {
      console.warn('Failed to retrieve progress from cache', err);
    }

    return results;
  }

  if (method === 'DELETE' && event.path.endsWith('/progress/cleanup')) {
    // Clean up unwanted progress items (unwatched or finished)
    const allItems = await prisma.progress_items.findMany({
      where: { user_id: userId },
    });

    const itemsToDelete: string[] = [];

    // Group items by tmdbId for show processing
    const itemsByTmdbId: Record<string, any[]> = {};
    for (const item of allItems) {
      if (!itemsByTmdbId[item.tmdb_id]) {
        itemsByTmdbId[item.tmdb_id] = [];
      }
      itemsByTmdbId[item.tmdb_id].push(item);
    }

    for (const [tmdbId, items] of Object.entries(itemsByTmdbId)) {
      const movieItems = items.filter(item => !item.episode_id);
      const episodeItems = items.filter(item => item.episode_id);

      // Process movies
      for (const item of movieItems) {
        const duration = Number(item.duration);
        const watched = Number(item.watched);
        const isNotStarted = progressIsNotStarted(duration, watched);
        const isCompleted = progressIsCompleted(duration, watched);

        if (isNotStarted || isCompleted) {
          itemsToDelete.push(item.id);
        }
      }

      // Process episodes - group by season
      const episodesBySeason: Record<string, any[]> = {};
      for (const item of episodeItems) {
        const seasonKey = `${item.season_id}`;
        if (!episodesBySeason[seasonKey]) {
          episodesBySeason[seasonKey] = [];
        }
        episodesBySeason[seasonKey].push(item);
      }

      for (const seasonItems of Object.values(episodesBySeason)) {
        // Check if season has any acceptable episodes
        const hasAcceptableEpisodes = seasonItems.some((item: any) => {
          const duration = Number(item.duration);
          const watched = Number(item.watched);
          return !progressIsNotStarted(duration, watched) &&
                 !progressIsCompleted(duration, watched);
        });

        if (hasAcceptableEpisodes) {
          // If season has acceptable episodes, only delete unacceptable ones
          for (const item of seasonItems) {
            const duration = Number(item.duration);
            const watched = Number(item.watched);
            const isNotStarted = progressIsNotStarted(duration, watched);
            const isCompleted = progressIsCompleted(duration, watched);

            if (isNotStarted || isCompleted) {
              itemsToDelete.push(item.id);
            }
          }
        } else {
          // If no acceptable episodes in season, delete all
          itemsToDelete.push(...seasonItems.map((item: any) => item.id));
        }
      }
    }

    if (itemsToDelete.length > 0) {
      await prisma.progress_items.deleteMany({
        where: {
          id: { in: itemsToDelete },
          user_id: userId,
        },
      });
    }

    return {
      deletedCount: itemsToDelete.length,
      message: `Cleaned up ${itemsToDelete.length} unwanted progress items`,
    };
  }

  throw createError({
    statusCode: 405,
    message: 'Method not allowed',
  });
});
