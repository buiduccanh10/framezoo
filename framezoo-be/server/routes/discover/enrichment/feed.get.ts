import { z } from 'zod';

import { getEnrichmentFeed } from '~/utils/discover-enrichment';

const querySchema = z.object({
  kind: z.string().trim().min(1),
});

export default defineCachedEventHandler(
  async event => {
    const parsed = querySchema.safeParse(getQuery(event));
    if (!parsed.success) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid enrichment feed query',
      });
    }

    try {
      return await getEnrichmentFeed(parsed.data.kind);
    } catch (error) {
      console.error('[Discover Enrichment] Failed to fetch feed:', error);
      throw createError({
        statusCode: 502,
        statusMessage: 'Failed to fetch discover enrichment feed',
      });
    }
  },
  {
    maxAge: process.env.NODE_ENV === 'production' ? 60 * 30 : 0,
  }
);
