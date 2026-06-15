import { joinURL } from 'ufo';

const ONE_HOUR_SECONDS = 60 * 60;
const ONE_MONTH_SECONDS = 30 * 24 * 60 * 60;
const TMDB_PROXY_METADATA_CACHE_TTL = Number(
  process.env.TMDB_PROXY_METADATA_CACHE_TTL || ONE_MONTH_SECONDS
);
const TMDB_PROXY_DETAIL_CACHE_TTL = Number(
  process.env.TMDB_PROXY_DETAIL_CACHE_TTL || ONE_HOUR_SECONDS
);
const TMDB_DETAIL_PATH_PATTERNS = [
  /^movie\/\d+$/i,
  /^tv\/\d+$/i,
  /^tv\/\d+\/season\/\d+$/i,
  /^tv\/\d+\/season\/\d+\/episode\/\d+$/i,
];

const toPositiveTtl = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;

const resolveTmdbCacheTtl = (path: string) => {
  const normalizedPath = path.replace(/^\/+|\/+$/g, '').toLowerCase();
  const metadataTtl = toPositiveTtl(TMDB_PROXY_METADATA_CACHE_TTL, ONE_MONTH_SECONDS);
  const detailTtl = toPositiveTtl(TMDB_PROXY_DETAIL_CACHE_TTL, ONE_HOUR_SECONDS);

  if (TMDB_DETAIL_PATH_PATTERNS.some(pattern => pattern.test(normalizedPath))) {
    return detailTtl;
  }

  return metadataTtl;
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

  // Determine actual fetch URL: direct or via proxy
  let fetchUrl = targetUrl;
  let fetchParams = finalQuery;

  if (tmdbProxy) {
    const urlWithQuery = new URL(targetUrl);
    Object.entries(finalQuery).forEach(([key, val]) => {
      urlWithQuery.searchParams.append(key, String(val));
    });
    fetchUrl = `${tmdbProxy}/?destination=${encodeURIComponent(urlWithQuery.toString())}`;
    fetchParams = {}; // Query is moved into destination URL
    console.log(`[TMDB Proxy] Forwarding via Proxy: ${tmdbProxy} for ${path}`);
  } else {
    console.log(`[TMDB Proxy] Forwarding Direct: ${targetUrl}`);
  }

  try {
    const data = await $fetch(fetchUrl, {
      method: event.method as any,
      query: fetchParams,
      headers,
      retry: 3,
      retryDelay: 2000,
      timeout: 15000,
    });

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
