import { useAuth } from '~/utils/auth';
import { z } from 'zod';
import { scopedLogger } from '~/utils/logger';

const log = scopedLogger('user-bookmarks');

const bookmarkMetaSchema = z.object({
  title: z.string(),
  year: z.number(),
  poster: z.string().optional(),
  type: z.enum(['movie', 'show']),
});

const bookmarkRequestSchema = z.object({
  meta: bookmarkMetaSchema.optional(),
  tmdbId: z.string().optional(),
  group: z.union([z.string(), z.array(z.string())]).optional(),
  favoriteEpisodes: z.array(z.string()).optional(),
});

export default defineEventHandler(async event => {
  const userId = getRouterParam(event, 'id');
  const tmdbId = getRouterParam(event, 'tmdbid');
  const session = await useAuth().getCurrentSession();

  if (session.user !== userId) {
    throw createError({ statusCode: 403, message: 'Cannot access bookmarks for other users' });
  }

  if (event.method === 'POST') {
    try {
      const body = await readBody(event);
      log.info('Creating bookmark', { userId, tmdbId, body });

      const validated = bookmarkRequestSchema.parse(body);
      const meta = bookmarkMetaSchema.parse(validated.meta || body);
      const group = validated.group ? (Array.isArray(validated.group) ? validated.group : [validated.group]) : [];
      const favoriteEpisodes = validated.favoriteEpisodes || [];

      const bookmark = await prisma.bookmarks.upsert({
        where: { tmdb_id_user_id: { tmdb_id: tmdbId, user_id: session.user } },
        update: { meta, group, favorite_episodes: favoriteEpisodes, updated_at: new Date() },
        create: { user_id: session.user, tmdb_id: tmdbId, meta, group, favorite_episodes: favoriteEpisodes, updated_at: new Date() },
      });

      log.info('Bookmark created successfully', { userId, tmdbId });
      return {
        tmdbId: bookmark.tmdb_id,
        meta: bookmark.meta,
        group: bookmark.group,
        favoriteEpisodes: bookmark.favorite_episodes,
        updatedAt: bookmark.updated_at,
      };
    } catch (error) {
      log.error('Failed to create bookmark', { userId, tmdbId, error: error instanceof Error ? error.message : String(error) });
      if (error instanceof z.ZodError) throw createError({ statusCode: 400, message: JSON.stringify(error.errors, null, 2) });
      throw error;
    }
  } else if (event.method === 'DELETE') {
    log.info('Deleting bookmark', { userId, tmdbId });
    try {
      await prisma.bookmarks.delete({ where: { tmdb_id_user_id: { tmdb_id: tmdbId, user_id: session.user } } });
      log.info('Bookmark deleted successfully', { userId, tmdbId });
    } catch (error) {
      log.error('Failed to delete bookmark', { userId, tmdbId, error: error instanceof Error ? error.message : String(error) });
    }
    return { success: true, tmdbId };
  }

  throw createError({ statusCode: 405, message: 'Method not allowed' });
});
