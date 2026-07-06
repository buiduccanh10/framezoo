import { z } from 'zod';

import { getNetworkEnrichment } from '~/utils/discover-enrichment';

const querySchema = z.object({
  tmdbId: z.string().trim().min(1),
  type: z.enum(['movie', 'show']),
});

export default defineCachedEventHandler(
  async event => {
    const parsed = querySchema.safeParse(getQuery(event));
    if (!parsed.success) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid enrichment network query',
      });
    }

    try {
      return await getNetworkEnrichment(parsed.data.tmdbId, parsed.data.type);
    } catch (error) {
      console.error('[Discover Enrichment] Failed to fetch network info:', error);
      throw createError({
        statusCode: 502,
        statusMessage: 'Failed to fetch network enrichment',
      });
    }
  },
  {
    maxAge: process.env.NODE_ENV === 'production' ? 60 * 60 * 12 : 0,
  }
);
