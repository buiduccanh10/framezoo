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
      console.error('[RT] Failed to scrape Rotten Tomatoes:', error);
      throw createError({
        statusCode: 502,
        statusMessage: 'Failed to fetch Rotten Tomatoes data',
      });
    }
  },
  {
    maxAge: process.env.NODE_ENV === 'production' ? 60 * 60 * 6 : 0,
  },
);
