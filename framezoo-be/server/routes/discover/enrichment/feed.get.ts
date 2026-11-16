import { z } from 'zod';

import { getEnrichmentFeed, type EnrichmentListResponse } from '~/utils/discover-enrichment';
import { filterEnrichmentFeedByTakedown, getActiveTakedownBlocklist } from '~/utils/takedown';

const querySchema = z.object({
  kind: z.string().trim().min(1),
});

export default defineEventHandler(async event => {
  const parsed = querySchema.safeParse(getQuery(event));
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid enrichment feed query',
    });
  }

  const blocklist = await getActiveTakedownBlocklist();
  const storage = process.env.NODE_ENV === 'production' ? useStorage('cache') : null;
  const cacheKey = `discover:enrichment:feed:${parsed.data.kind}`;

  if (storage) {
    try {
      const cached = await storage.getItem<EnrichmentListResponse>(cacheKey);
      if (cached) {
        return filterEnrichmentFeedByTakedown(cached, blocklist.tmdbIds);
      }
    } catch {
      // Fall through to upstream fetch.
    }
  }

  try {
    const feed = await getEnrichmentFeed(parsed.data.kind);
    if (storage) {
      try {
        await storage.setItem(cacheKey, feed, { ttl: 60 * 30 });
      } catch {
        // Ignore cache write errors.
      }
    }
    return filterEnrichmentFeedByTakedown(feed, blocklist.tmdbIds);
  } catch (error) {
    console.error('[Discover Enrichment] Failed to fetch feed:', error);
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to fetch discover enrichment feed',
    });
  }
});
