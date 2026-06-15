import { useAuth } from '~/utils/auth';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { scopedLogger } from '~/utils/logger';

const log = scopedLogger('progress-import');

const progressMetaSchema = z.object({
  title: z.string(),
  type: z.enum(['movie', 'show']),
  year: z.number().optional(),
  poster: z.string().optional(),
});

const progressItemSchema = z.object({
  meta: progressMetaSchema,
  tmdbId: z.string().transform(val => val || randomUUID()),
  duration: z
    .number()
    .min(0)
    .transform(n => Math.round(n)),
  watched: z
    .number()
    .min(0)
    .transform(n => Math.round(n)),
  seasonId: z.string().optional(),
  episodeId: z.string().optional(),
  seasonNumber: z.number().optional(),
  episodeNumber: z.number().optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
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

  const session = await useAuth().getCurrentSession();

  if (session.user !== userId) {
    throw createError({
      statusCode: 403,
      message: 'Cannot modify user other than yourself',
    });
  }

  // First check if user exists
  const user = await prisma.users.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw createError({
      statusCode: 404,
      message: 'User not found',
    });
  }

  if (event.method !== 'PUT') {
    throw createError({
      statusCode: 405,
      message: 'Method not allowed',
    });
  }

  try {
    const body = await readBody(event);
    const validatedBody = z.array(progressItemSchema).parse(body);

    const existingItems = await prisma.progress_items.findMany({
      where: { user_id: userId },
    });

    const newItems = [...validatedBody];
    const itemsToUpsert = [];

    for (const existingItem of existingItems) {
      const newItemIndex = newItems.findIndex(
        item =>
          item.tmdbId === existingItem.tmdb_id &&
          item.seasonId === (existingItem.season_id === '\n' ? null : existingItem.season_id) &&
          item.episodeId === (existingItem.episode_id === '\n' ? null : existingItem.episode_id)
      );

      if (newItemIndex > -1) {
        const newItem = newItems[newItemIndex];

        if (Number(existingItem.watched) < newItem.watched) {
          const isMovie = newItem.meta.type === 'movie';
          itemsToUpsert.push({
            id: existingItem.id,
            tmdb_id: existingItem.tmdb_id,
            user_id: existingItem.user_id,
            season_id: isMovie ? '\n' : existingItem.season_id,
            episode_id: isMovie ? '\n' : existingItem.episode_id,
            season_number: existingItem.season_number,
            episode_number: existingItem.episode_number,
            duration: BigInt(newItem.duration),
            watched: BigInt(newItem.watched),
            meta: newItem.meta,
            updated_at: defaultAndCoerceDateTime(newItem.updatedAt),
          });
        }

        newItems.splice(newItemIndex, 1);
      }
    }

    // Create new items
    for (const item of newItems) {
      const isMovie = item.meta.type === 'movie';
      itemsToUpsert.push({
        id: randomUUID(),
        tmdb_id: item.tmdbId,
        user_id: userId,
        season_id: isMovie ? '\n' : item.seasonId || null,
        episode_id: isMovie ? '\n' : item.episodeId || null,
        season_number: isMovie ? null : item.seasonNumber,
        episode_number: isMovie ? null : item.episodeNumber,
        duration: BigInt(item.duration),
        watched: BigInt(item.watched),
        meta: item.meta,
        updated_at: defaultAndCoerceDateTime(item.updatedAt),
      });
    }

    // Upsert all items
    const results = [];
    for (const item of itemsToUpsert) {
      try {
        const result = await prisma.progress_items.upsert({
          where: {
            tmdb_id_user_id_season_id_episode_id: {
              tmdb_id: item.tmdb_id,
              user_id: item.user_id,
              season_id: item.season_id,
              episode_id: item.episode_id,
            },
          },
          create: item,
          update: {
            duration: item.duration,
            watched: item.watched,
            meta: item.meta,
            updated_at: item.updated_at,
          },
        });

        results.push({
          id: result.id,
          tmdbId: result.tmdb_id,
          episode: {
            id: result.episode_id === '\n' ? null : result.episode_id,
            number: result.episode_number,
          },
          season: {
            id: result.season_id === '\n' ? null : result.season_id,
            number: result.season_number,
          },
          meta: result.meta,
          duration: result.duration.toString(),
          watched: result.watched.toString(),
          updatedAt: result.updated_at.toISOString(),
        });
      } catch (error) {
        log.error('Failed to upsert progress item', {
          userId,
          tmdbId: item.tmdb_id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    return results;
  } catch (error) {
    log.error('Failed to import progress', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof z.ZodError) {
      throw createError({
        statusCode: 400,
        message: 'Invalid progress data',
        cause: error.errors,
      });
    }

    throw createError({
      statusCode: 500,
      message: 'Failed to import progress',
      cause: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
