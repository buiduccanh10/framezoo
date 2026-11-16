import { z } from 'zod';

import { getNetworkEnrichment } from '~/utils/discover-enrichment';
import { getActiveTakedownBlocklist, isTmdbBlocked } from '~/utils/takedown';

const querySchema = z.object({
  tmdbId: z.string().trim().min(1),
  type: z.enum(['movie', 'show']),
});

export default defineEventHandler(async event => {
  const parsed = querySchema.safeParse(getQuery(event));
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid enrichment network query',
    });
  }

  const blocklist = await getActiveTakedownBlocklist();
  const mediaType = parsed.data.type === 'show' ? 'tv' : 'movie';
  if (isTmdbBlocked(parsed.data.tmdbId, blocklist.tmdbIds, mediaType)) {
    throw createError({
      statusCode: 451,
      statusMessage: 'Unavailable For Legal Reasons',
      message: 'This title is unavailable following a legal or copyright notice.',
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
});
