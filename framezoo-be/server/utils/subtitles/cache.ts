import type { StremioSubtitle } from './types';

export const SUBTITLE_CACHE_PREFIX = 'addon:subtitles:v1:';
export const MOVIE_SUBTITLE_CACHE_TTL = 24 * 60 * 60; // 24 hours
export const SERIES_SUBTITLE_CACHE_TTL = 12 * 60 * 60; // 12 hours
export const EMPTY_SUBTITLE_CACHE_TTL = 10 * 60; // 10 minutes (negative caching for retries)

// Prevent concurrent upstream fetches for the same media key (cache stampede protection)
const inFlightSearches = new Map<string, Promise<StremioSubtitle[]>>();

/**
 * Generates a normalized cache key for subtitles.
 * e.g. "addon:subtitles:v1:movie:tt1877830" or "addon:subtitles:v1:series:tt0944947:1:1"
 */
export const getSubtitleCacheKey = (type: string, cleanId: string): string => {
  const sanitizedId = cleanId.replace(/\s+/g, '_');
  return `${SUBTITLE_CACHE_PREFIX}${type}:${sanitizedId}`;
};

/**
 * Resolves TTL in seconds depending on content type and whether results were found.
 */
export const getSubtitleTtl = (type: string, subtitleCount: number): number => {
  if (subtitleCount === 0) {
    return EMPTY_SUBTITLE_CACHE_TTL;
  }
  return type === 'series' ? SERIES_SUBTITLE_CACHE_TTL : MOVIE_SUBTITLE_CACHE_TTL;
};

/**
 * Ensures SubSource download URLs inside cached subtitles always point to the current request's origin.
 */
export const normalizeSubtitleDownloadUrls = (
  subtitles: StremioSubtitle[],
  currentOrigin: string
): StremioSubtitle[] => {
  return subtitles.map(sub => {
    if (sub.source === 'subsource' && sub.url) {
      const match = sub.url.match(/\/addon\/subtitles\/download\/subsource\/(.+)$/);
      if (match) {
        return {
          ...sub,
          url: `${currentOrigin}/addon/subtitles/download/subsource/${match[1]}`,
        };
      }
    }
    return sub;
  });
};

/**
 * Retrieves cached subtitles from Redis via Nitro cache storage.
 */
export const getCachedSubtitles = async (cacheKey: string): Promise<StremioSubtitle[] | null> => {
  try {
    const storage = useStorage('cache');
    const cached = await storage.getItem<StremioSubtitle[]>(cacheKey);
    if (Array.isArray(cached)) {
      return cached;
    }
  } catch (err) {
    console.warn('[subtitles:cache] Redis read error:', err);
  }
  return null;
};

/**
 * Stores subtitles in Redis via Nitro cache storage with the given TTL.
 */
export const setCachedSubtitles = async (
  cacheKey: string,
  subtitles: StremioSubtitle[],
  ttlSeconds: number
): Promise<void> => {
  try {
    const storage = useStorage('cache');
    await storage.setItem(cacheKey, subtitles, { ttl: ttlSeconds });
  } catch (err) {
    console.warn('[subtitles:cache] Redis write error:', err);
  }
};

/**
 * Deduplicates in-flight upstream search calls to prevent cache stampedes.
 */
export const executeWithInFlightDeduplication = (
  cacheKey: string,
  searchFn: () => Promise<StremioSubtitle[]>
): Promise<StremioSubtitle[]> => {
  const existing = inFlightSearches.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      return await searchFn();
    } finally {
      inFlightSearches.delete(cacheKey);
    }
  })();

  inFlightSearches.set(cacheKey, promise);
  return promise;
};
