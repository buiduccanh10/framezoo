import { joinURL } from 'ufo';

const ONE_HOUR_SECONDS = 60 * 60;
const ONE_MONTH_SECONDS = 30 * 24 * 60 * 60;
const toPositiveTtl = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;

const TMDB_PROXY_METADATA_CACHE_TTL = Number(
  process.env.TMDB_PROXY_METADATA_CACHE_TTL || ONE_MONTH_SECONDS
);
const TMDB_PROXY_DETAIL_CACHE_TTL = Number(
  process.env.TMDB_PROXY_DETAIL_CACHE_TTL || ONE_HOUR_SECONDS
);
const TMDB_PROXY_SORT_SOURCE_PAGE_COUNT = toPositiveTtl(
  Number(process.env.TMDB_PROXY_SORT_SOURCE_PAGE_COUNT || 10),
  10
);
const TMDB_MIN_VOTE_COUNT = 100;
const TMDB_BAYESIAN_WEIGHT = 100;
const TMDB_DETAIL_PATH_PATTERNS = [
  /^movie\/\d+$/i,
  /^tv\/\d+$/i,
  /^tv\/\d+\/season\/\d+$/i,
  /^tv\/\d+\/season\/\d+\/episode\/\d+$/i,
];
const TMDB_SORTABLE_PATH_PATTERNS = [
  /^discover\/(?:movie|tv)$/i,
  /^search\/(?:movie|tv|multi)$/i,
  /^trending\/(?:movie|tv)\/(?:day|week)$/i,
  /^(?:movie|tv)\/(?:popular|top_rated|now_playing|on_the_air|airing_today|upcoming)$/i,
  /^(?:movie|tv)\/\d+\/recommendations$/i,
];

type SortableMediaItem = Record<string, any>;
type TmdbResultsPayload = {
  page?: number;
  results?: SortableMediaItem[];
  total_pages?: number;
  total_results?: number;
};

const resolveTmdbCacheTtl = (path: string) => {
  const normalizedPath = path.replace(/^\/+|\/+$/g, '').toLowerCase();
  const metadataTtl = toPositiveTtl(TMDB_PROXY_METADATA_CACHE_TTL, ONE_MONTH_SECONDS);
  const detailTtl = toPositiveTtl(TMDB_PROXY_DETAIL_CACHE_TTL, ONE_HOUR_SECONDS);

  if (TMDB_DETAIL_PATH_PATTERNS.some(pattern => pattern.test(normalizedPath))) {
    return detailTtl;
  }

  return metadataTtl;
};

const normalizeTmdbPath = (path: string) => path.replace(/^\/+|\/+$/g, '').toLowerCase();

const toPositiveInteger = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
};

const extractYear = (value: unknown): number | null => {
  if (value instanceof Date) {
    const year = value.getFullYear();
    return Number.isFinite(year) ? year : null;
  }

  if (typeof value !== 'string') return null;

  const parsedYear = Number.parseInt(value.slice(0, 4), 10);
  return Number.isFinite(parsedYear) ? parsedYear : null;
};

const getReferenceYear = (item: SortableMediaItem): number => {
  const seasonYears = Array.isArray(item.seasons)
    ? item.seasons
        .map((season: SortableMediaItem) => extractYear(season?.air_date))
        .filter((year): year is number => year !== null)
    : [];

  const candidateYears = [
    extractYear(item.last_episode_to_air?.air_date),
    extractYear(item.last_air_date),
    seasonYears.length ? Math.max(...seasonYears) : null,
    extractYear(item.air_date),
    extractYear(item.release_date),
    extractYear(item.first_air_date),
    extractYear(item.original_release_date),
  ].filter((year): year is number => year !== null);

  return candidateYears.length > 0 ? Math.max(...candidateYears) : 0;
};

const isMovieOrTvResult = (item: unknown): item is SortableMediaItem => {
  if (!item || typeof item !== 'object') return false;

  const candidate = item as SortableMediaItem;
  if (candidate.media_type === 'person') return false;
  if (candidate.media_type === 'movie' || candidate.media_type === 'tv') {
    return true;
  }

  return (
    'vote_average' in candidate ||
    'vote_count' in candidate ||
    'release_date' in candidate ||
    'first_air_date' in candidate ||
    'last_air_date' in candidate
  );
};

const meetsTmdbQualityThreshold = (item: SortableMediaItem) => {
  if (!isMovieOrTvResult(item)) return true;

  const voteCount = Number(item.vote_count) || 0;

  return voteCount >= TMDB_MIN_VOTE_COUNT;
};

const filterTmdbResultsByQuality = (items: SortableMediaItem[]) =>
  items.filter(meetsTmdbQualityThreshold);

const getGlobalAverageVote = (items: SortableMediaItem[]) => {
  const scores = items
    .map((item) => Number(item.vote_average) || 0)
    .filter((score) => score > 0);

  if (scores.length === 0) return 0;

  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
};

const getBayesianWeightedRating = (
  item: SortableMediaItem,
  globalAverage: number,
) => {
  const votes = Number(item.vote_count) || 0;
  const rating = Number(item.vote_average) || 0;

  if (votes <= 0) return 0;

  return (
    (votes / (votes + TMDB_BAYESIAN_WEIGHT)) * rating +
    (TMDB_BAYESIAN_WEIGHT / (votes + TMDB_BAYESIAN_WEIGHT)) * globalAverage
  );
};

const compareSortableMediaItems = (
  a: SortableMediaItem,
  b: SortableMediaItem,
  globalAverage: number,
) => {
  const isMediaA = isMovieOrTvResult(a);
  const isMediaB = isMovieOrTvResult(b);

  if (isMediaA !== isMediaB) {
    return isMediaA ? -1 : 1;
  }

  if (!isMediaA && !isMediaB) return 0;

  const yearDiff = getReferenceYear(b) - getReferenceYear(a);
  if (yearDiff !== 0) return yearDiff;

  const bayesianDiff =
    getBayesianWeightedRating(b, globalAverage) -
    getBayesianWeightedRating(a, globalAverage);
  if (bayesianDiff !== 0) return bayesianDiff;

  const voteCountDiff = (Number(b.vote_count) || 0) - (Number(a.vote_count) || 0);
  if (voteCountDiff !== 0) return voteCountDiff;

  const voteAverageDiff = (Number(b.vote_average) || 0) - (Number(a.vote_average) || 0);
  if (voteAverageDiff !== 0) return voteAverageDiff;

  const popularityDiff = (Number(b.popularity) || 0) - (Number(a.popularity) || 0);
  if (popularityDiff !== 0) return popularityDiff;

  return (Number(b.id) || 0) - (Number(a.id) || 0);
};

const sortTmdbResults = (items: SortableMediaItem[]) => {
  const globalAverage = getGlobalAverageVote(items);
  return [...items].sort((a, b) => compareSortableMediaItems(a, b, globalAverage));
};

const isSortableTmdbPath = (path: string) => {
  const normalizedPath = normalizeTmdbPath(path);
  return TMDB_SORTABLE_PATH_PATTERNS.some(pattern => pattern.test(normalizedPath));
};

const hasSortableResultsPayload = (payload: unknown): payload is TmdbResultsPayload =>
  Boolean(payload) &&
  typeof payload === 'object' &&
  'results' in payload &&
  Array.isArray((payload as TmdbResultsPayload).results);

const shouldAggregateTmdbResults = (path: string, payload: TmdbResultsPayload) =>
  isSortableTmdbPath(path) &&
  Array.isArray(payload.results) &&
  payload.results.length > 0 &&
  toPositiveInteger(payload.total_pages, 1) > 1 &&
  TMDB_PROXY_SORT_SOURCE_PAGE_COUNT > 1;

const sortAndPaginateTmdbResults = async (
  path: string,
  requestedPage: number,
  firstPayload: TmdbResultsPayload,
  fetchPage: (pageNumber: number) => Promise<TmdbResultsPayload>
) => {
  if (!hasSortableResultsPayload(firstPayload) || !isSortableTmdbPath(path)) {
    return firstPayload;
  }

  if (!shouldAggregateTmdbResults(path, firstPayload)) {
    const filteredResults = filterTmdbResultsByQuality(firstPayload.results ?? []);
    const sortedResults = sortTmdbResults(filteredResults);

    return {
      ...firstPayload,
      page: requestedPage,
      total_results: sortedResults.length,
      results: sortedResults,
    };
  }

  const sourcePageCount = Math.min(
    toPositiveInteger(firstPayload.total_pages, 1),
    TMDB_PROXY_SORT_SOURCE_PAGE_COUNT
  );

  if (requestedPage > sourcePageCount) {
    const filteredResults = filterTmdbResultsByQuality(firstPayload.results ?? []);
    const sortedResults = sortTmdbResults(filteredResults);

    return {
      ...firstPayload,
      page: requestedPage,
      total_pages: sourcePageCount,
      total_results: sortedResults.length,
      results: sortedResults,
    };
  }

  const additionalPages = Array.from({ length: sourcePageCount }, (_, index) => index + 1).filter(
    pageNumber => pageNumber !== requestedPage
  );
  const additionalPayloads = await Promise.all(additionalPages.map(pageNumber => fetchPage(pageNumber)));
  const pageSize = firstPayload.results?.length || 20;
  const mergedFilteredResults = filterTmdbResultsByQuality(
    [firstPayload, ...additionalPayloads].flatMap(payload => payload.results ?? [])
  );
  const mergedResults = sortTmdbResults(mergedFilteredResults);
  const totalPages = Math.max(1, Math.ceil(mergedResults.length / pageSize));
  const startIndex = (requestedPage - 1) * pageSize;

  return {
    ...firstPayload,
    page: requestedPage,
    total_pages: totalPages,
    total_results: mergedResults.length,
    results: mergedResults.slice(startIndex, startIndex + pageSize),
  };
};

export default defineEventHandler(async event => {
  const config = useRuntimeConfig(event);
  const path = event.context.params?._;

  if (!path) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid TMDB path',
    });
  }

  const query = getQuery(event);
  const targetUrl = joinURL('https://api.tmdb.org/3', path);

  const tmdbKey = ((config.tmdbApiKey as string | undefined) || process.env.TMDB_API_KEY || '').trim();
  const tmdbProxy = (config.tmdbProxyUrl as string)?.trim();

  // --- Caching Logic ---
  const storage = useStorage('cache');
  const queryStr = JSON.stringify(query);
  const cacheKey = `tmdb:request:${path}:${Buffer.from(queryStr).toString('base64')}`;
  const cacheTtl = resolveTmdbCacheTtl(path);

  try {
    const cachedResponse = await storage.getItem(cacheKey);
    if (cachedResponse) {
      console.log(`[TMDB Proxy] Serving from cache: ${path}`);
      return cachedResponse;
    }
  } catch (err) {
    console.warn('[TMDB Proxy] Cache read error:', err);
  }
  // ---------------------

  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  };

  const finalQuery = { ...query };

  if (tmdbKey && tmdbKey.length > 50) {
    headers.Authorization = `Bearer ${tmdbKey}`;
    delete finalQuery.api_key;
  } else if (tmdbKey) {
    finalQuery.api_key = tmdbKey;
  }

  const buildFetchRequest = (queryParams: Record<string, any>) => {
    if (tmdbProxy) {
      const urlWithQuery = new URL(targetUrl);
      Object.entries(queryParams).forEach(([key, val]) => {
        urlWithQuery.searchParams.append(key, String(val));
      });

      return {
        fetchUrl: `${tmdbProxy}/?destination=${encodeURIComponent(urlWithQuery.toString())}`,
        fetchParams: {},
      };
    }

    return {
      fetchUrl: targetUrl,
      fetchParams: queryParams,
    };
  };

  const shouldAttachPageParam = 'page' in finalQuery || isSortableTmdbPath(path);
  const fetchTmdbPage = async (pageNumber?: number) => {
    const queryParams = { ...finalQuery };
    if (shouldAttachPageParam && typeof pageNumber === 'number') {
      queryParams.page = pageNumber;
    }
    const { fetchUrl, fetchParams } = buildFetchRequest(queryParams);

    return $fetch(fetchUrl, {
      method: event.method as any,
      query: fetchParams,
      headers,
      retry: 3,
      retryDelay: 2000,
      timeout: 15000,
    });
  };

  try {
    if (tmdbProxy) {
      console.log(`[TMDB Proxy] Forwarding via Proxy: ${tmdbProxy} for ${path}`);
    } else {
      console.log(`[TMDB Proxy] Forwarding Direct: ${targetUrl}`);
    }

    const requestedPage = toPositiveInteger(query.page, 1);
    const firstPayload = (await fetchTmdbPage(
      shouldAttachPageParam ? requestedPage : undefined
    )) as TmdbResultsPayload;
    const data = await sortAndPaginateTmdbResults(
      path,
      requestedPage,
      firstPayload,
      pageNumber => fetchTmdbPage(pageNumber) as Promise<TmdbResultsPayload>
    );

    // Cache TMDB metadata long; keep detail endpoints shorter.
    try {
      await storage.setItem(cacheKey, data as any, { ttl: cacheTtl });
      console.log(`[TMDB Proxy] Cached response for ${path} (ttl=${cacheTtl}s)`);
    } catch (err) {
      console.warn('[TMDB Proxy] Cache write error:', err);
    }

    return data;
  } catch (error: any) {
    const status = error.response?.status || 500;
    const errorData = error.data || error.message;
    console.error(`[TMDB Proxy] Failed to fetch ${targetUrl}:`, {
      status,
      message: error.message,
      data: error.data,
    });

    throw createError({
      statusCode: status,
      statusMessage: error.response?.statusText || 'TMDB Fetch Error',
      data: errorData,
    });
  }
});
