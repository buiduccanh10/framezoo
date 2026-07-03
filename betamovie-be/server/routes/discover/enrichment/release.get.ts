import { z } from 'zod';

import { getReleaseEnrichment } from '~/utils/discover-enrichment';

const querySchema = z.object({
  tmdbId: z.string().trim().min(1),
});

export default defineCachedEventHandler(
  async event => {
    const parsed = querySchema.safeParse(getQuery(event));
    if (!parsed.success) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid enrichment release query',
      });
    }

    try {
      return await getReleaseEnrichment(parsed.data.tmdbId);
    } catch (error) {
      console.error('[Discover Enrichment] Failed to fetch release info:', error);
      throw createError({
        statusCode: 502,
        statusMessage: 'Failed to fetch release enrichment',
      });
    }
  },
  {
    maxAge: process.env.NODE_ENV === 'production' ? 60 * 60 * 12 : 0,
  }
);
