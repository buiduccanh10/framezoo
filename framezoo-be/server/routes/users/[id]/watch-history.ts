import { useAuth } from '~/utils/auth';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const watchHistoryMetaSchema = z.object({
  title: z.string(),
  year: z.number().optional(),
  poster: z.string().optional(),
  type: z.enum(['movie', 'show']),
});

const watchHistoryItemSchema = z.object({
  meta: watchHistoryMetaSchema,
  tmdbId: z.string(),
  duration: z.number().transform(n => n.toString()),
  watched: z.number().transform(n => n.toString()),
  watchedAt: z.string().datetime({ offset: true }),
  completed: z.boolean().optional().default(false),
  seasonId: z.string().optional(),
  episodeId: z.string().optional(),
  seasonNumber: z.number().optional(),
  episodeNumber: z.number().optional(),
});

// 13th July 2021 - movie-web epoch
const minEpoch = 1626134400000;

function defaultAndCoerceDateTime(dateTime: string | undefined) {
  const epoch = dateTime ? new Date(dateTime).getTime() : Date.now();
  const clampedEpoch = Math.max(minEpoch, Math.min(epoch, Date.now()));
  return new Date(clampedEpoch);
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
    const items = await prisma.watch_history.findMany({
      where: { user_id: userId },
      orderBy: { watched_at: 'desc' },
    });

    return items.map(item => ({
      tmdbId: item.tmdb_id,
      episode: {
        id: item.episode_id === '\n' ? undefined : item.episode_id || undefined,
        number: item.episode_number || undefined,
      },
      season: {
        id: item.season_id === '\n' ? undefined : item.season_id || undefined,
        number: item.season_number || undefined,
      },
      meta: item.meta,
      duration: item.duration.toString(),
      watched: item.watched.toString(),
      watchedAt: item.watched_at.toISOString(),
      completed: item.completed,
    }));
  }

  throw createError({
    statusCode: 405,
    message: 'Method not allowed',
  });
});
