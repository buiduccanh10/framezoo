import { z } from 'zod';

import { scrapeIMDb } from '~/utils/imdb';

const imdbQuerySchema = z.object({
  imdbId: z.string().trim().min(1),
  season: z
    .union([z.string(), z.number()])
    .optional()
    .transform(value => {
      if (value === undefined) return undefined;
      const parsed = typeof value === 'number' ? value : parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }),
  episode: z
    .union([z.string(), z.number()])
    .optional()
    .transform(value => {
      if (value === undefined) return undefined;
      const parsed = typeof value === 'number' ? value : parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }),
  language: z.string().trim().optional(),
});

export default defineCachedEventHandler(
  async event => {
    const parsed = imdbQuerySchema.safeParse(getQuery(event));
    if (!parsed.success) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid IMDb query',
      });
    }

    try {
      return await scrapeIMDb(
        parsed.data.imdbId,
        parsed.data.season,
        parsed.data.episode,
        parsed.data.language,
      );
    } catch (error) {
      console.error('[IMDb] Failed to scrape IMDb:', error);
      throw createError({
        statusCode: 502,
        statusMessage: 'Failed to fetch IMDb data',
      });
    }
  },
  {
    maxAge: process.env.NODE_ENV === 'production' ? 60 * 60 * 6 : 0,
  },
);
