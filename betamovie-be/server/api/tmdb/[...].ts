import { joinURL } from 'ufo';
import { $fetch } from 'ofetch';

import {
  getTmdbErrorStatus,
  isRetryableTmdbError,
  isTmdbTimeoutError,
  TMDB_FALLBACK_BASE_URL,
  TMDB_PRIMARY_BASE_URL,
  TMDB_RETRY_ATTEMPTS,
  TMDB_RETRY_DELAY_MS,
  TMDB_RETRY_STATUS_CODES,
  TMDB_TIMEOUT_MS,
} from '~/utils/tmdbConfig';

const ONE_HOUR_SECONDS = 60 * 60;
const ONE_DAY_SECONDS = 24 * 60 * 60;
const toPositiveTtl = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;

const TMDB_PROXY_METADATA_CACHE_TTL = Number(
  process.env.TMDB_PROXY_METADATA_CACHE_TTL || ONE_DAY_SECONDS
);
const TMDB_PROXY_DETAIL_CACHE_TTL = Number(
  process.env.TMDB_PROXY_DETAIL_CACHE_TTL || ONE_HOUR_SECONDS
);
const TMDB_PROXY_CACHE_VERSION = 'v3';

const TMDB_DETAIL_PATH_PATTERNS = [
  /^movie\/\d+$/i,
  /^tv\/\d+$/i,
  /^tv\/\d+\/season\/\d+$/i,
  /^tv\/\d+\/season\/\d+\/episode\/\d+$/i,
];
const resolveTmdbCacheTtl = (path: string) => {
  const normalizedPath = path.replace(/^\/+|\/+$/g, '').toLowerCase();
  const metadataTtl = toPositiveTtl(TMDB_PROXY_METADATA_CACHE_TTL, ONE_DAY_SECONDS);
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
  const targetUrl = joinURL(TMDB_PRIMARY_BASE_URL, path);

  const tmdbKey = (
    (config.tmdbApiKey as string | undefined) ||
    process.env.TMDB_API_KEY ||
    ''
  ).trim();
  const tmdbProxy = (config.tmdbProxyUrl as string)?.trim();

  // --- Caching Logic ---
  const storage = useStorage('cache');
  const queryStr = JSON.stringify(query);
  const cacheKey = `tmdb:${TMDB_PROXY_CACHE_VERSION}:request:${path}:${Buffer.from(queryStr).toString('base64')}`;
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

  const buildFetchRequest = (
    baseUrl: string,
    queryParams: Record<string, any>,
  ) => {
    if (tmdbProxy) {
      const urlWithQuery = new URL(joinURL(baseUrl, path));
      Object.entries(queryParams).forEach(([key, val]) => {
        urlWithQuery.searchParams.append(key, String(val));
      });

      return {
        fetchUrl: `${tmdbProxy}/?destination=${encodeURIComponent(urlWithQuery.toString())}`,
        fetchParams: {},
      };
    }

    return {
      fetchUrl: joinURL(baseUrl, path),
      fetchParams: queryParams,
    };
  };

  const shouldAttachPageParam = 'page' in finalQuery;
  const fetchTmdbPage = async (baseUrl: string, pageNumber?: number) => {
    const queryParams = { ...finalQuery };
    if (shouldAttachPageParam && typeof pageNumber === 'number') {
      queryParams.page = pageNumber;
    }
    const { fetchUrl, fetchParams } = buildFetchRequest(baseUrl, queryParams);

    return $fetch(fetchUrl, {
      method: event.method as any,
      query: fetchParams,
      headers,
      retry: TMDB_RETRY_ATTEMPTS,
      retryDelay: TMDB_RETRY_DELAY_MS,
      retryStatusCodes: TMDB_RETRY_STATUS_CODES,
      timeout: TMDB_TIMEOUT_MS,
    });
  };

  const fetchFromTmdb = async (baseUrl: string) => {
    const data = await fetchTmdbPage(baseUrl);

    try {
      await storage.setItem(cacheKey, data as any, { ttl: cacheTtl });
      console.log(`[TMDB Proxy] Cached response for ${path} (ttl=${cacheTtl}s)`);
    } catch (err) {
      console.warn('[TMDB Proxy] Cache write error:', err);
    }

    return data;
  };

  try {
    console.log(`[TMDB Proxy] Forwarding primary: ${joinURL(TMDB_PRIMARY_BASE_URL, path)}`);

    try {
      return await fetchFromTmdb(TMDB_PRIMARY_BASE_URL);
    } catch (primaryError: any) {
      if (!isRetryableTmdbError(primaryError)) {
        throw primaryError;
      }

      console.warn('[TMDB Proxy] Primary host failed; trying fallback host.', {
        path,
        status: getTmdbErrorStatus(primaryError),
        message: primaryError?.message,
      });
    }

    console.log(`[TMDB Proxy] Forwarding fallback: ${joinURL(TMDB_FALLBACK_BASE_URL, path)}`);
    return await fetchFromTmdb(TMDB_FALLBACK_BASE_URL);
  } catch (error: any) {
    const upstreamStatus = getTmdbErrorStatus(error);
    const status = isTmdbTimeoutError(error)
      ? 504
      : upstreamStatus || 502;
    const errorData = error.data || error.message;
    console.error(`[TMDB Proxy] Failed to fetch ${targetUrl}:`, {
      status,
      upstreamStatus,
      message: error.message,
      data: error.data,
    });

    throw createError({
      statusCode: status,
      statusMessage:
        status === 504
          ? 'TMDB upstream timeout'
          : error.response?.statusText || 'TMDB Fetch Error',
      data: errorData,
    });
  }
});
