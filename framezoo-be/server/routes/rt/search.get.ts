import { z } from 'zod';

import { scrapeRottenTomatoes } from '~/utils/rotten-tomatoes';

const searchSchema = z.object({
  title: z.string().trim().min(1),
  year: z
    .union([z.string(), z.number()])
    .optional()
    .transform(value => {
      if (value === undefined) return undefined;
      const parsed = typeof value === 'number' ? value : parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }),
});

export default defineCachedEventHandler(
  async event => {
    const parsed = searchSchema.safeParse(getQuery(event));
    if (!parsed.success) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid Rotten Tomatoes search query',
      });
    }

    try {
      return await scrapeRottenTomatoes(parsed.data.title, parsed.data.year);
    } catch (error) {
      const statusCode =
        error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number'
          ? error.statusCode
          : 502;
      console.error('[RT] Failed to fetch Rotten Tomatoes score from OMDb:', error);
      throw createError({
        statusCode,
        statusMessage:
          statusCode === 503
            ? 'OMDB_API_KEY is not configured on server'
            : 'Failed to fetch Rotten Tomatoes data',
      });
    }
  },
  {
    maxAge: process.env.NODE_ENV === 'production' ? 60 * 60 * 6 : 0,
  },
);
