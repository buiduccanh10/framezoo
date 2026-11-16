import { z } from 'zod';

import { getReleaseEnrichment } from '~/utils/discover-enrichment';
import { getActiveTakedownBlocklist, isTmdbBlocked } from '~/utils/takedown';

const querySchema = z.object({
  tmdbId: z.string().trim().min(1),
});

export default defineEventHandler(async event => {
  const parsed = querySchema.safeParse(getQuery(event));
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid enrichment release query',
    });
  }

  const blocklist = await getActiveTakedownBlocklist();
  if (isTmdbBlocked(parsed.data.tmdbId, blocklist.tmdbIds, 'movie')) {
    throw createError({
      statusCode: 451,
      statusMessage: 'Unavailable For Legal Reasons',
      message: 'This title is unavailable following a legal or copyright notice.',
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
});
