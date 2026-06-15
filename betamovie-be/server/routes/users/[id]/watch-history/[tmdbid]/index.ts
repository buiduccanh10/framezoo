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
  const tmdbId = event.context.params?.tmdbid;
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

  if (method === 'PUT') {
    try {
      const body = await readBody(event);

      // Accept single object (normal playback) or array (e.g. user import)
      const bodySchema = z.union([
        watchHistoryItemSchema,
        z.array(watchHistoryItemSchema),
      ]);
      const parsed = bodySchema.parse(body);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      const results = [];

      for (const validatedBody of items) {
        const itemTmdbId = items.length === 1 ? tmdbId : (validatedBody.tmdbId ?? tmdbId);
        const watchedAt = defaultAndCoerceDateTime(validatedBody.watchedAt);
        const now = new Date();

        // Normalize IDs for movies (use '\n' instead of null to satisfy unique constraint)
        const normSeasonId = validatedBody.meta.type === 'movie' ? '\n' : validatedBody.seasonId ?? null;
        const normEpisodeId = validatedBody.meta.type === 'movie' ? '\n' : validatedBody.episodeId ?? null;

        const existingItem = await prisma.watch_history.findUnique({
          where: {
            tmdb_id_user_id_season_id_episode_id: {
              tmdb_id: itemTmdbId,
              user_id: userId,
              season_id: normSeasonId,
              episode_id: normEpisodeId,
            },
          },
        });

        const data = {
          duration: parseFloat(validatedBody.duration),
          watched: parseFloat(validatedBody.watched),
          watched_at: watchedAt,
          completed: validatedBody.completed,
          meta: validatedBody.meta,
          updated_at: now,
        };

        let watchHistoryItem;

        if (existingItem) {
          watchHistoryItem = await prisma.watch_history.update({
            where: { id: existingItem.id },
            data,
          });
        } else {
          watchHistoryItem = await prisma.watch_history.create({
            data: {
              id: randomUUID(),
              tmdb_id: itemTmdbId,
              user_id: userId,
              season_id: normSeasonId,
              episode_id: normEpisodeId,
              season_number: validatedBody.seasonNumber ?? null,
              episode_number: validatedBody.episodeNumber ?? null,
              ...data,
            },
          });
        }

        results.push({
          success: true,
          id: watchHistoryItem.id,
          tmdbId: watchHistoryItem.tmdb_id,
          userId: watchHistoryItem.user_id,
          seasonId: watchHistoryItem.season_id,
          episodeId: watchHistoryItem.episode_id,
          seasonNumber: watchHistoryItem.season_number,
          episodeNumber: watchHistoryItem.episode_number,
          meta: watchHistoryItem.meta,
          duration: watchHistoryItem.duration,
          watched: watchHistoryItem.watched,
          watchedAt: watchHistoryItem.watched_at.toISOString(),
          completed: watchHistoryItem.completed,
          updatedAt: watchHistoryItem.updated_at.toISOString(),
        });
      }

      return results.length === 1 ? results[0] : { success: true, count: results.length, items: results };
    } catch (dbError) {
      console.error('Database error:', dbError);
      throw createError({
        statusCode: 500,
        message: 'Failed to save watch history',
      });
    }
  }

  if (method === 'DELETE') {
    const body = await readBody(event).catch(() => ({}));

    const whereClause: any = {
      user_id: userId,
      tmdb_id: tmdbId,
    };

    if (body.seasonId) whereClause.season_id = body.seasonId;
    if (body.episodeId) whereClause.episode_id = body.episodeId;

    const itemsToDelete = await prisma.watch_history.findMany({
      where: whereClause,
    });

    if (itemsToDelete.length === 0) {
      return {
        success: true,
        count: 0,
        tmdbId,
        episodeId: body.episodeId,
        seasonId: body.seasonId,
      };
    }

    await prisma.watch_history.deleteMany({
      where: whereClause,
    });

    return {
      success: true,
      count: itemsToDelete.length,
      tmdbId,
      episodeId: body.episodeId,
      seasonId: body.seasonId,
    };
  }

  throw createError({
    statusCode: 405,
    message: 'Method not allowed',
  });
});
