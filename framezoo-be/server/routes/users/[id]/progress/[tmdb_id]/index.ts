import { useAuth } from '~/utils/auth';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const progressMetaSchema = z.object({
  title: z.string(),
  poster: z.string().optional(),
  type: z.enum(['movie', 'tv', 'show']),
  year: z.number().optional(),
});

const progressItemSchema = z.object({
  meta: progressMetaSchema,
  tmdbId: z.string(),
  duration: z.number().transform(Math.round),
  watched: z.number().transform(Math.round),
  seasonId: z.string().optional(),
  episodeId: z.string().optional(),
  seasonNumber: z.number().optional(),
  episodeNumber: z.number().optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
});

// 13th July 2021 - movie-web epoch
const minEpoch = 1626134400000;

function progressIsNotStarted(duration: number, watched: number): boolean {
  if (watched < 20) return true;
  return false;
}

function progressIsCompleted(duration: number, watched: number): boolean {
  const timeFromEnd = duration - watched;
  if (timeFromEnd < 60 * 2) return true;
  return false;
}

async function shouldSaveProgress(
  userId: string,
  tmdbId: string,
  validatedBody: z.infer<typeof progressItemSchema>,
) {
  const duration = validatedBody.duration;
  const watched = validatedBody.watched;

  const isNotStarted = progressIsNotStarted(duration, watched);
  const isCompleted = progressIsCompleted(duration, watched);
  const isAcceptable = !isNotStarted && !isCompleted;

  if (validatedBody.meta.type === 'movie') {
    return isAcceptable;
  }

  if (isAcceptable) return true;
  if (!validatedBody.seasonId) return false;

  const seasonEpisodes = await prisma.progress_items.findMany({
    where: {
      user_id: userId,
      tmdb_id: tmdbId,
      season_id: validatedBody.seasonId,
      episode_id: {
        not: validatedBody.episodeId || null,
      },
    },
  });

  return seasonEpisodes.some((episode) => {
    const episodeDuration = Number(episode.duration);
    const episodeWatched = Number(episode.watched);
    return (
      !progressIsNotStarted(episodeDuration, episodeWatched) &&
      !progressIsCompleted(episodeDuration, episodeWatched)
    );
  });
}

const coerceDateTime = (dateTime?: string) => {
  const epoch = dateTime ? new Date(dateTime).getTime() : Date.now();
  return new Date(Math.max(minEpoch, Math.min(epoch, Date.now())));
};

const normalizeIds = (metaType: string, seasonId?: string, episodeId?: string) => ({
  seasonId: metaType === 'movie' ? '\n' : seasonId || null,
  episodeId: metaType === 'movie' ? '\n' : episodeId || null,
});

const formatProgressItem = (item: any) => ({
  id: item.id,
  tmdbId: item.tmdb_id,
  userId: item.user_id,
  seasonId: item.season_id === '\n' ? null : item.season_id,
  episodeId: item.episode_id === '\n' ? null : item.episode_id,
  seasonNumber: item.season_number,
  episodeNumber: item.episode_number,
  meta: item.meta,
  duration: Number(item.duration),
  watched: Number(item.watched),
  updatedAt: item.updated_at,
});

const formatUnsavedProgressItem = (
  userId: string,
  tmdbId: string,
  parsedBody: z.infer<typeof progressItemSchema>,
  updatedAt: Date,
) => ({
  id: '',
  tmdbId,
  userId,
  seasonId: parsedBody.seasonId ?? null,
  episodeId: parsedBody.episodeId ?? null,
  seasonNumber: parsedBody.seasonNumber ?? null,
  episodeNumber: parsedBody.episodeNumber ?? null,
  meta: parsedBody.meta,
  duration: parsedBody.duration,
  watched: parsedBody.watched,
  updatedAt,
});

function hasSameProgressPayload(
  item: any,
  duration: number,
  watched: number,
  meta: z.infer<typeof progressMetaSchema>,
) {
  return (
    Number(item.duration) === duration &&
    Number(item.watched) === watched &&
    JSON.stringify(item.meta) === JSON.stringify(meta)
  );
}

export default defineEventHandler(async (event) => {
  const { id: userId, tmdb_id: tmdbId } = event.context.params!;
  const method = event.method;

  const session = await useAuth().getCurrentSession();
  if (!session) {
    throw createError({ statusCode: 401, message: 'Session not found or expired' });
  }

  if (session.user !== userId) {
    throw createError({ statusCode: 403, message: 'Unauthorized' });
  }

  const storage = useStorage('cache');

  if (method === 'PUT') {
    const body = await readBody(event);
    let parsedBody;
    try {
      parsedBody = progressItemSchema.parse(body);
    } catch (error) {
      throw createError({ statusCode: 400, message: error.message });
    }
    const { meta, duration, watched, seasonId, episodeId, seasonNumber, episodeNumber, updatedAt } = parsedBody;

    const now = coerceDateTime(updatedAt);
    const { seasonId: normSeasonId, episodeId: normEpisodeId } = normalizeIds(meta.type, seasonId, episodeId);

    const queueKey = `progress_queue:${userId}:${tmdbId}:${normSeasonId || 'none'}:${normEpisodeId || 'none'}`;
    const dataToQueue = {
      tmdbId,
      userId,
      seasonId: normSeasonId,
      episodeId: normEpisodeId,
      seasonNumber: seasonNumber ?? null,
      episodeNumber: episodeNumber ?? null,
      duration,
      watched,
      meta,
      updatedAt: now.toISOString(),
    };

    await storage.setItem(queueKey, dataToQueue);

    return formatUnsavedProgressItem(userId, tmdbId, parsedBody, now);
  }

  if (method === 'DELETE') {
    const body = await readBody(event).catch(() => ({}));
    const where: any = { user_id: userId, tmdb_id: tmdbId };

    const { seasonId: normSeasonId, episodeId: normEpisodeId } = normalizeIds(body.meta?.type || 'show', body.seasonId, body.episodeId);

    if (normSeasonId) where.season_id = normSeasonId;
    if (normEpisodeId) where.episode_id = normEpisodeId;

    const items = await prisma.progress_items.findMany({ where });
    if (items.length > 0) {
      await prisma.progress_items.deleteMany({ where });
    }

    // Also delete any queued items for this movie/episode
    const queueKeyPrefix = `progress_queue:${userId}:${tmdbId}:${normSeasonId || '*'}:${normEpisodeId || '*'}`;
    const keys = await storage.getKeys(queueKeyPrefix.replace(/\*/g, ''));
    // Since unstorage getKeys matches prefixes, we just filter the keys manually to be safe
    for (const key of keys) {
      const parts = key.split(':');
      // parts = ['progress_queue', userId, tmdbId, seasonId, episodeId]
      const kSeasonId = parts[3];
      const kEpisodeId = parts[4];
      const matchSeason = normSeasonId ? kSeasonId === normSeasonId : true;
      const matchEpisode = normEpisodeId ? kEpisodeId === normEpisodeId : true;
      if (matchSeason && matchEpisode) {
        await storage.removeItem(key);
      }
    }

    return { count: items.length, tmdbId, episodeId: body.episodeId, seasonId: body.seasonId };
  }

  throw createError({ statusCode: 405, message: 'Method not allowed' });
});
