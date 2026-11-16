import { getCuratedEnrichmentLists, type EnrichmentCuratedList } from '~/utils/discover-enrichment';
import { filterCuratedListsByTakedown, getActiveTakedownBlocklist } from '~/utils/takedown';

const CURATED_CACHE_KEY = 'discover:enrichment:curated:v1';

export default defineEventHandler(async event => {
  const blocklist = await getActiveTakedownBlocklist();
  const storage = process.env.NODE_ENV === 'production' ? useStorage('cache') : null;

  if (storage) {
    try {
      const cached = await storage.getItem<EnrichmentCuratedList[]>(CURATED_CACHE_KEY);
      if (cached) {
        return filterCuratedListsByTakedown(cached, blocklist.tmdbIds);
      }
    } catch {
      // Fall through to upstream fetch.
    }
  }

  try {
    const lists = await getCuratedEnrichmentLists(event);
    if (storage) {
      try {
        await storage.setItem(CURATED_CACHE_KEY, lists, { ttl: 60 * 60 * 6 });
      } catch {
        // Ignore cache write errors.
      }
    }
    return filterCuratedListsByTakedown(lists, blocklist.tmdbIds);
  } catch (error) {
    console.error('[Discover Enrichment] Failed to fetch curated lists:', error);
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to fetch curated discover lists',
    });
  }
});
