import { getCuratedEnrichmentLists } from '~/utils/discover-enrichment';

export default defineCachedEventHandler(
  async event => {
    try {
      return await getCuratedEnrichmentLists(event);
    } catch (error) {
      console.error('[Discover Enrichment] Failed to fetch curated lists:', error);
      throw createError({
        statusCode: 502,
        statusMessage: 'Failed to fetch curated discover lists',
      });
    }
  },
  {
    maxAge: process.env.NODE_ENV === 'production' ? 60 * 60 * 6 : 0,
  }
);
