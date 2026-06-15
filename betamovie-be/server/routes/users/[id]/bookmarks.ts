import { useAuth } from '~/utils/auth';
import { z } from 'zod';
import { bookmarks } from '@prisma/client';

const bookmarkMetaSchema = z.object({
  title: z.string(),
  year: z.number().optional(),
  poster: z.string().optional(),
  type: z.enum(['movie', 'show']),
});

const bookmarkDataSchema = z.object({
  tmdbId: z.string(),
  meta: bookmarkMetaSchema,
  group: z.union([z.string(), z.array(z.string())]).optional(),
  favoriteEpisodes: z.array(z.string()).optional(),
});

export default defineEventHandler(async event => {
  const userId = event.context.params?.id;
  const method = event.method;

  const session = await useAuth().getCurrentSession();

  if (session.user !== userId) {
    throw createError({
      statusCode: 403,
      message: 'Cannot access other user information',
    });
  }

  if (method === 'GET') {
    const bookmarks = await prisma.bookmarks.findMany({
      where: { user_id: userId },
    });

    return bookmarks.map((bookmark: bookmarks) => ({
      tmdbId: bookmark.tmdb_id,
      meta: bookmark.meta,
      group: bookmark.group,
      favoriteEpisodes: bookmark.favorite_episodes,
      updatedAt: bookmark.updated_at,
    }));
  }

  if (method === 'PUT') {
    const body = await readBody(event);
    const validatedBody = z.array(bookmarkDataSchema).parse(body);

    const now = new Date();
    const results = [];

    for (const item of validatedBody) {
      // Normalize group to always be an array
      const normalizedGroup = item.group 
        ? (Array.isArray(item.group) ? item.group : [item.group])
        : [];

      // Normalize favoriteEpisodes to always be an array
      const normalizedFavoriteEpisodes = item.favoriteEpisodes || [];

      const bookmark = await prisma.bookmarks.upsert({
        where: {
          tmdb_id_user_id: {
            tmdb_id: item.tmdbId,
            user_id: userId,
          },
        },
        update: {
          meta: item.meta,
          group: normalizedGroup,
          favorite_episodes: normalizedFavoriteEpisodes,
          updated_at: now,
        } as any,
        create: {
          tmdb_id: item.tmdbId,
          user_id: userId,
          meta: item.meta,
          group: normalizedGroup,
          favorite_episodes: normalizedFavoriteEpisodes,
          updated_at: now,
        } as any,
      }) as bookmarks;

      results.push({
        tmdbId: bookmark.tmdb_id,
        meta: bookmark.meta,
        group: bookmark.group,
        favoriteEpisodes: bookmark.favorite_episodes,
        updatedAt: bookmark.updated_at,
      });
    }

    return results;
  }


  throw createError({
    statusCode: 405,
    message: 'Method not allowed',
  });
});
