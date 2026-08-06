import { joinURL } from 'ufo';
import { $fetch } from 'ofetch';
import type { StorageValue } from 'unstorage';

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
import { scopedLogger } from '~/utils/logger';

const ONE_HOUR_SECONDS = 60 * 60;
const ONE_DAY_SECONDS = 24 * 60 * 60;
const logger = scopedLogger('tmdb-proxy');

type TmdbQuery = Record<string, unknown>;
type TmdbFetchRequest = {
  fetchUrl: string;
  fetchParams: TmdbQuery;
};
type TmdbRequestError = {
  data?: unknown;
  message?: unknown;
  response?: {
    statusText?: unknown;
  };
};

const toPositiveTtl = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
const parseTtl = (value: string | undefined, fallback: number): number => Number(value || fallback);

const metadataTtlValue = process.env.TMDB_PROXY_METADATA_CACHE_TTL;
const detailTtlValue = process.env.TMDB_PROXY_DETAIL_CACHE_TTL;
const TMDB_PROXY_METADATA_CACHE_TTL = parseTtl(metadataTtlValue, ONE_DAY_SECONDS);
const TMDB_PROXY_DETAIL_CACHE_TTL = parseTtl(detailTtlValue, ONE_HOUR_SECONDS);
const TMDB_PROXY_CACHE_VERSION = 'v3';

const TMDB_DETAIL_PATH_PATTERNS = [
  /^movie\/\d+$/i,
  /^tv\/\d+$/i,
  /^tv\/\d+\/season\/\d+$/i,
  /^tv\/\d+\/season\/\d+\/episode\/\d+$/i,
];
const resolveTmdbCacheTtl = (path: string): number => {
  const normalizedPath = path.replace(/^\/+|\/+$/g, '').toLowerCase();
  const metadataTtl = toPositiveTtl(TMDB_PROXY_METADATA_CACHE_TTL, ONE_DAY_SECONDS);
  const detailTtl = toPositiveTtl(TMDB_PROXY_DETAIL_CACHE_TTL, ONE_HOUR_SECONDS);

  if (TMDB_DETAIL_PATH_PATTERNS.some(pattern => pattern.test(normalizedPath))) {
    return detailTtl;
  }

  return metadataTtl;
};

const getErrorDetails = (error: unknown): TmdbRequestError =>
  error && typeof error === 'object' ? error : {};

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
  const finalQuery: TmdbQuery = { ...query, include_adult: false };

  const configuredTmdbKey = typeof config.tmdbApiKey === 'string' ? config.tmdbApiKey : '';
  const tmdbKey = (configuredTmdbKey || process.env.TMDB_API_KEY || '').trim();
  const tmdbProxy = (config.tmdbProxyUrl as string)?.trim();

  // --- Caching Logic ---
  const storage = useStorage('cache');
  const queryStr = JSON.stringify(query);
  const cacheKey = `tmdb:${TMDB_PROXY_CACHE_VERSION}:request:${path}:${Buffer.from(queryStr).toString('base64')}`;
  const cacheTtl = resolveTmdbCacheTtl(path);

  try {
    const cachedResponse = await storage.getItem(cacheKey);
    if (cachedResponse) {
      logger.info(`Serving from cache: ${path}`);
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

  if (tmdbKey && tmdbKey.length > 50) {
    headers.Authorization = `Bearer ${tmdbKey}`;
    delete finalQuery.api_key;
  } else if (tmdbKey) {
    finalQuery.api_key = tmdbKey;
  }

  const buildFetchRequest = (baseUrl: string, queryParams: TmdbQuery): TmdbFetchRequest => {
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
  const fetchTmdbPage = async (baseUrl: string, pageNumber?: number): Promise<StorageValue> => {
    const queryParams = { ...finalQuery };
    if (shouldAttachPageParam && typeof pageNumber === 'number') {
      queryParams.page = pageNumber;
    }
    const { fetchUrl, fetchParams } = buildFetchRequest(baseUrl, queryParams);

    return $fetch<StorageValue>(fetchUrl, {
      method: event.method,
      query: fetchParams,
      headers,
      retry: TMDB_RETRY_ATTEMPTS,
      retryDelay: TMDB_RETRY_DELAY_MS,
      retryStatusCodes: TMDB_RETRY_STATUS_CODES,
      timeout: TMDB_TIMEOUT_MS,
    });
  };

  const fetchFromTmdb = async (baseUrl: string): Promise<StorageValue> => {
    const data = await fetchTmdbPage(baseUrl);

    try {
      await storage.setItem(cacheKey, data, { ttl: cacheTtl });
      logger.info(`Cached response for ${path} (ttl=${cacheTtl}s)`);
    } catch (err) {
      console.warn('[TMDB Proxy] Cache write error:', err);
    }

    return data;
  };

  try {
    logger.info(`Forwarding primary: ${joinURL(TMDB_PRIMARY_BASE_URL, path)}`);

    try {
      return await fetchFromTmdb(TMDB_PRIMARY_BASE_URL);
    } catch (primaryError) {
      if (!isRetryableTmdbError(primaryError)) {
        throw primaryError;
      }

      const primaryErrorDetails = getErrorDetails(primaryError);
      logger.warn('Primary host failed; trying fallback host.', {
        path,
        status: getTmdbErrorStatus(primaryError),
        message: primaryErrorDetails.message,
      });
    }

    logger.info(`Forwarding fallback: ${joinURL(TMDB_FALLBACK_BASE_URL, path)}`);
    return await fetchFromTmdb(TMDB_FALLBACK_BASE_URL);
  } catch (error) {
    const errorDetails = getErrorDetails(error);
    const upstreamStatus = getTmdbErrorStatus(error);
    const status = isTmdbTimeoutError(error) ? 504 : upstreamStatus || 502;
    const errorMessage =
      typeof errorDetails.message === 'string' ? errorDetails.message : String(error);
    const errorData = errorDetails.data || errorMessage;
    logger.error(`Failed to fetch ${targetUrl}`, {
      status,
      upstreamStatus,
      message: errorMessage,
      data: errorDetails.data,
    });

    throw createError({
      statusCode: status,
      statusMessage:
        status === 504
          ? 'TMDB upstream timeout'
          : typeof errorDetails.response?.statusText === 'string'
            ? errorDetails.response.statusText
            : 'TMDB Fetch Error',
      data: errorData,
    });
  }
});
