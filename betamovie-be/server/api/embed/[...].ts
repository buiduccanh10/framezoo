import { joinURL } from 'ufo';
import { createHash } from 'node:crypto';
import { getProvider } from '~/providers/registry';
import { getProviderMetadata } from '~/providers/metadata';
import { request } from 'undici';
import {
  buildPreviewAutoResource,
  buildPreviewFileResource,
  buildStreamPreview,
  parsePreviewAutoResource,
  parsePreviewFileResource,
} from '~/utils/preview';
import { applyCorsHeaders } from '~/utils/cors';
import {
  assertSafeUpstreamUrl,
  buildProxyRequestUrl,
  getProxyResponseLimit,
  getProxyPoolForUrl,
  normalizeProxyHeaders,
  readResponseBytesLimited,
  requireProxyAccess,
} from '~/utils/proxySecurity';

const timestamp = () => new Date().toISOString();
const logInfo = (message: string, ...args: any[]) => {
  console.log(`[${timestamp()}] [Embed Proxy] ${message}`, ...args);
};
const logWarn = (message: string, ...args: any[]) => {
  console.warn(`[${timestamp()}] [Embed Proxy] ${message}`, ...args);
};
const logError = (message: string, ...args: any[]) => {
  console.error(`[${timestamp()}] [Embed Proxy] ${message}`, ...args);
};

const internalFetch = <T = unknown>(url: string, options: Record<string, any>) =>
  ($fetch as any)(url, options) as Promise<T>;

const readProxyHeader = (headers: Record<string, string>, name: string) =>
  headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || '';

const normalizeStableSearch = (searchParams: URLSearchParams) => {
  const volatileKeys = new Set([
    'token',
    'expires',
    'exp',
    'signature',
    'sig',
    'x-signature',
    'x-amz-signature',
    'x-amz-date',
    'x-amz-expires',
    'hmac',
    'auth',
    'ts',
    'timestamp',
  ]);

  const stable = new URLSearchParams();
  const keys = [...new Set(Array.from(searchParams.keys()))].sort();
  for (const key of keys) {
    if (volatileKeys.has(key.toLowerCase())) continue;
    const values = searchParams.getAll(key).map(String).sort();
    for (const value of values) {
      stable.append(key, value);
    }
  }
  return stable.toString();
};

const toStableQueryString = (query: Record<string, any>) => {
  const params = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (Array.isArray(value)) {
      for (const item of [...value].map(String).sort()) {
        params.append(key, item);
      }
      continue;
    }
    if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  }
  return params.toString();
};

const hashKey = (input: string) => createHash('sha256').update(input).digest('hex');

const parseProxyHeaders = (rawHeaders: unknown) => {
  if (typeof rawHeaders !== 'string') return {};
  try {
    const parsed = JSON.parse(rawHeaders);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>(
      (acc, [key, value]) => {
        if (typeof value === 'string') {
          acc[key] = value;
        }
        return acc;
      },
      {}
    );
  } catch {
    return {};
  }
};

const toTsProxyIdentity = (query: Record<string, any>) => {
  const target = typeof query.url === 'string' ? query.url : '';
  const headers = parseProxyHeaders(query.headers);
  const referer = readProxyHeader(headers, 'referer');
  const identity = new URLSearchParams();

  if (target) {
    try {
      const parsed = new URL(target);
      identity.set('srcHost', parsed.host);
      identity.set('srcPath', parsed.pathname);
      const stableSrcQuery = normalizeStableSearch(parsed.searchParams);
      if (stableSrcQuery) {
        identity.set('srcQuery', stableSrcQuery);
      }
    } catch {
      identity.set('srcRaw', target);
    }
  }

  if (referer) {
    try {
      const parsedReferer = new URL(referer);
      const stableRefQuery = normalizeStableSearch(parsedReferer.searchParams);
      identity.set('refPath', parsedReferer.pathname);
      if (stableRefQuery) {
        identity.set('refQuery', stableRefQuery);
      }
    } catch {
      identity.set('ref', referer);
    }
  }

  if (typeof query.noSynth === 'string') {
    identity.set('noSynth', query.noSynth);
  }
  if (typeof query.progressiveOpen === 'string') {
    identity.set('progressiveOpen', query.progressiveOpen);
  }
  if (typeof query.clampOpen === 'string') {
    identity.set('clampOpen', query.clampOpen);
  }

  return identity.toString();
};

/**
 * Set CORS headers for CDN and browser
 */
const setCORSHeaders = (event: any) => {
  applyCorsHeaders(event, 'GET, OPTIONS, HEAD', '*');
  // Cache control headers for CDN
  setHeader(event, 'cache-control', 'public, max-age=600, s-maxage=1800');
};

const buildInternalAuthHeaders = (event: any) => {
  const headers: Record<string, string> = {};
  const authorization = getRequestHeader(event, 'authorization');
  const cookie = getRequestHeader(event, 'cookie');

  if (authorization) {
    headers.authorization = authorization;
  }
  if (cookie) {
    headers.cookie = cookie;
  }

  const internalToken = getRequestHeader(event, 'x-internal-token');
  const capability = getRequestHeader(event, 'x-proxy-capability');
  if (internalToken) {
    headers['x-internal-token'] = internalToken;
  }
  if (capability) {
    headers['x-proxy-capability'] = capability;
  }

  return headers;
};

export default defineEventHandler(async event => {
  const path = event.context.params?._;
  const internalAuthHeaders = buildInternalAuthHeaders(event);

  if (!path) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid path',
    });
  }

  // Handle OPTIONS for CORS
  if (event.method === 'OPTIONS') {
    setCORSHeaders(event);
    return null;
  }

  // --- Stream API Handler ---
  // Handle /api/streams/[provider]/[...] internally (direct provider call)
  if (path.startsWith('api/streams/')) {
    const streamQuery = getQuery(event) as Record<string, any>;
    const streamsPathParts = path.replace('api/streams/', '').split('/');
    const providerName = streamsPathParts[0];
    const restPath = streamsPathParts.slice(1).join('/');

    logInfo(
      `[Embed Proxy] Handling stream request internally: provider=${providerName}, path=${restPath}`
    );

    // Parse path components
    const parts = restPath.split('/').filter(Boolean);
    if (parts.length < 2 || parts.length > 4) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid path format. Expected: type/tmdbId or type/tmdbId/season/episode',
      });
    }

    const provider = getProvider(providerName);
    if (!provider) {
      throw createError({
        statusCode: 404,
        statusMessage: `Provider '${providerName}' not found`,
      });
    }

    const type = parts[0];
    const tmdbId = parts[1];
    const season = parts[2] ? parseInt(parts[2], 10) : null;
    const episode = parts[3] ? parseInt(parts[3], 10) : null;

    // Validate type
    if (type !== 'movie' && type !== 'tv') {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid type. Must be 'movie' or 'tv'",
      });
    }

    // For TV shows, require season and episode
    if (type === 'tv' && (!season || !episode)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Season and episode numbers are required for TV shows',
      });
    }

    try {
      const storage = useStorage('cache');
      const title =
        typeof streamQuery.title === 'string' && streamQuery.title.trim().length > 0
          ? streamQuery.title.trim()
          : undefined;
      const originName =
        typeof streamQuery.originName === 'string' && streamQuery.originName.trim().length > 0
          ? streamQuery.originName.trim()
          : undefined;
      const releaseYearRaw =
        typeof streamQuery.releaseYear === 'string' || typeof streamQuery.releaseYear === 'number'
          ? Number.parseInt(String(streamQuery.releaseYear), 10)
          : Number.NaN;
      const releaseYear = Number.isFinite(releaseYearRaw) ? releaseYearRaw : undefined;
      const country =
        typeof streamQuery.country === 'string' && streamQuery.country.trim().length > 0
          ? streamQuery.country.trim()
          : undefined;
      const contextCacheKey = `stream-meta:${providerName}:${type}:${tmdbId}${type === 'tv' ? `:${season}:${episode}` : ''}`;

      if (title || originName || releaseYear || country) {
        await storage
          .setItem(
            contextCacheKey,
            {
              title,
              originName,
              releaseYear,
              country,
            },
            { ttl: 60 * 60 }
          )
          .catch(() => null);
      }

      // Check cache first
      const cacheKey = `streams:${providerName}:${type}:${tmdbId}${type === 'tv' ? `:${season}:${episode}` : ''}`;
      const cached = await storage
        .getItem<{
          success: boolean;
          tmdbId: string;
          imdbId: string | null;
          count: number;
          providerTimings: Record<string, number>;
          streams: any[];
        }>(cacheKey)
        .catch(() => null);

      if (cached) {
        logInfo(`[Embed Proxy] Serving streams from cache: ${cacheKey}`);
        setHeader(event, 'x-cache', 'HIT');
        setCORSHeaders(event);
        return cached;
      }

      // Get streams from provider (direct call)
      const streamsRaw = await provider.getStreams(
        tmdbId,
        type as 'movie' | 'tv',
        season,
        episode,
        storage,
        {
          title,
          originName,
          releaseYear,
          country,
        }
      );

      const origin = getRequestURL(event).origin;
      const streams = await Promise.all(
        streamsRaw.map(async (s: any) => {
          const headers = s?.headers ?? {};
          let proxiedUrl = s.url;
          if (s?.streamType !== 'dash' && s?.streamType !== 'file') {
            const safeUrl = await assertSafeUpstreamUrl(s.url);
            proxiedUrl = buildProxyRequestUrl(origin, '/api/m3u8-proxy', 'm3u8', safeUrl, headers);
          }
          const preview =
            s?.streamType === 'dash' || s?.streamType === 'file'
              ? undefined
              : buildStreamPreview({
                  origin,
                  provider: providerName,
                  mediaType: type as 'movie' | 'tv',
                  tmdbId,
                  season,
                  episode,
                  headers,
                });

          return {
            ...s,
            url: proxiedUrl,
            preview,
          };
        })
      );

      const result = {
        success: true,
        tmdbId,
        imdbId: null,
        count: streams.length,
        providerTimings: {},
        streams,
      };

      // Cache only successful non-empty stream results so empty provider responses reload next time.
      if (streams.length > 0) {
        await storage.setItem(cacheKey, result, { ttl: 180 }).catch(err => {
          logWarn('[Embed Proxy] Failed to cache streams result:', err);
        });
      }

      setHeader(event, 'x-cache', 'MISS');
      setCORSHeaders(event);
      logInfo(`[Embed Proxy] Returning ${streams.length} streams for ${tmdbId}`);
      return result;
    } catch (error: any) {
      logError(`[Embed Proxy] Error fetching streams: ${error.message}`);
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to fetch streams',
      });
    }
  }

  // --- Providers API Handler ---
  // Handle /api/providers internally
  if (path === 'api/providers') {
    logInfo(`[Embed Proxy] Handling providers list internally`);
    setCORSHeaders(event);
    return {
      providers: getProviderMetadata(),
    };
  }

  const query = getQuery(event) as Record<string, any>;

  // --- TMDB compat handler (internal) ---
  // Frontend expects /api/embed/api/tmdb/*
  if (path.startsWith('api/tmdb/')) {
    const origin = getRequestURL(event).origin;
    const rest = path.replace('api/tmdb/', '');
    const internalUrl = joinURL(origin, `/api/tmdb/${rest}`);
    logInfo(`[Embed Proxy] Handling TMDB internally: ${path} -> ${internalUrl}`);
    return await internalFetch(internalUrl, {
      method: event.method as any,
      query,
      headers: internalAuthHeaders,
      timeout: 15000,
    });
  }

  // --- m3u8-proxy compat handler (internal) ---
  // Some clients call /api/embed/api/m3u8-proxy; handle it here to avoid any upstream.
  if (path === 'api/m3u8-proxy') {
    const origin = getRequestURL(event).origin;
    const targetUrl = typeof query.url === 'string' ? query.url.trim() : '';
    if (!targetUrl) {
      throw createError({ statusCode: 400, statusMessage: 'Missing url' });
    }

    let normalizedTargetUrl: string;
    try {
      normalizedTargetUrl = await assertSafeUpstreamUrl(targetUrl);
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'Unsafe upstream URL' });
    }

    const headers = normalizeProxyHeaders(parseProxyHeaders(query.headers));
    await requireProxyAccess(event, {
      kind: 'm3u8',
      targetUrl: normalizedTargetUrl,
      headers,
    });

    return sendRedirect(
      event,
      buildProxyRequestUrl(origin, '/api/m3u8-proxy', 'm3u8', normalizedTargetUrl, headers),
      307
    );
  }

  if (path === 'api/media-proxy') {
    const origin = getRequestURL(event).origin;
    const targetUrl = typeof query.url === 'string' ? query.url.trim() : '';
    if (!targetUrl) {
      throw createError({ statusCode: 400, statusMessage: 'Missing url' });
    }

    let normalizedTargetUrl: string;
    try {
      normalizedTargetUrl = await assertSafeUpstreamUrl(targetUrl);
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'Unsafe upstream URL' });
    }

    const headers = normalizeProxyHeaders(parseProxyHeaders(query.headers));
    await requireProxyAccess(event, {
      kind: 'media',
      targetUrl: normalizedTargetUrl,
      headers,
    });

    return sendRedirect(
      event,
      buildProxyRequestUrl(origin, '/api/media-proxy', 'media', normalizedTargetUrl, headers),
      307
    );
  }

  if (path === 'api/preview-proxy') {
    const origin = getRequestURL(event).origin;
    const targetUrl = typeof query.url === 'string' ? query.url.trim() : '';
    if (!targetUrl) {
      throw createError({ statusCode: 400, statusMessage: 'Missing url' });
    }

    let normalizedTargetUrl: string;
    try {
      normalizedTargetUrl = await assertSafeUpstreamUrl(targetUrl);
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'Unsafe upstream URL' });
    }

    const headers = normalizeProxyHeaders(parseProxyHeaders(query.headers));
    await requireProxyAccess(event, {
      kind: 'preview',
      targetUrl: normalizedTargetUrl,
      headers,
    });

    return sendRedirect(
      event,
      buildProxyRequestUrl(origin, '/api/preview-proxy', 'preview', normalizedTargetUrl, headers),
      307
    );
  }

  if (path === 'api/preview/auto') {
    const origin = getRequestURL(event).origin;
    const rawResource = typeof query.resource === 'string' ? query.resource : '';
    const parsedResource = rawResource ? parsePreviewAutoResource(rawResource) : null;
    const provider =
      parsedResource?.provider || (typeof query.provider === 'string' ? query.provider : '');
    const mediaType =
      parsedResource?.mediaType ||
      (query.type === 'tv' ? 'tv' : query.type === 'movie' ? 'movie' : '');
    const tmdbId =
      parsedResource?.tmdbId || (typeof query.tmdbId === 'string' ? query.tmdbId : '');
    const season =
      parsedResource?.season ??
      (typeof query.season === 'string' ? Number.parseInt(query.season, 10) : null);
    const episode =
      parsedResource?.episode ??
      (typeof query.episode === 'string' ? Number.parseInt(query.episode, 10) : null);
    const resource =
      rawResource ||
      buildPreviewAutoResource({
        provider,
        mediaType: mediaType as 'movie' | 'tv',
        tmdbId,
        season,
        episode,
      });
    await requireProxyAccess(event, {
      kind: 'preview-auto',
      resource,
    });

    return sendRedirect(
      event,
      buildProxyRequestUrl(origin, '/api/preview/auto', 'preview-auto', '', {}, resource),
      307
    );
  }

  if (path === 'api/preview/file') {
    const origin = getRequestURL(event).origin;
    const rawResource = typeof query.resource === 'string' ? query.resource : '';
    const parsedResource = rawResource ? parsePreviewFileResource(rawResource) : null;
    const key =
      parsedResource?.key || (rawResource ? '' : typeof query.key === 'string' ? query.key : '');
    const file =
      parsedResource?.file ||
      (rawResource ? '' : typeof query.file === 'string' ? query.file : '');
    if (!key || !file) {
      throw createError({ statusCode: 400, statusMessage: 'Missing key or file' });
    }

    const resource = rawResource || buildPreviewFileResource(key, file);
    await requireProxyAccess(event, {
      kind: 'preview-file',
      resource,
    });

    return sendRedirect(
      event,
      buildProxyRequestUrl(origin, '/api/preview/file', 'preview-file', '', {}, resource),
      307
    );
  }

  // --- ts-proxy / proxy handlers (internal, no upstream) ---
  const isTsProxyPath =
    path === 'ts-proxy' ||
    path.startsWith('ts-proxy/') ||
    path === 'api/ts-proxy' ||
    path.startsWith('api/ts-proxy/') ||
    path.startsWith('proxy/') ||
    path.startsWith('api/proxy/');
  const queryJson = JSON.stringify(query);
  const hasSegmentHint =
    /(\.ts|\.m4s|\.mp4|\.aac|\.vtt)(\?|$)/i.test(path) ||
    /(\.ts|\.m4s|\.mp4|\.aac|\.vtt)(\?|$)/i.test(queryJson);
  const isTsProxyCacheable = event.method === 'GET' && isTsProxyPath;

  if (isTsProxyCacheable) {
    const target = typeof query.url === 'string' ? query.url : '';
    if (!target) {
      throw createError({ statusCode: 400, statusMessage: 'Missing url' });
    }

    let normalizedTarget: string;
    try {
      normalizedTarget = await assertSafeUpstreamUrl(target);
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'Unsafe upstream URL' });
    }

    const customHeaders = normalizeProxyHeaders(parseProxyHeaders(query.headers));
    await requireProxyAccess(event, {
      kind: 'embed',
      targetUrl: normalizedTarget,
      headers: customHeaders,
    });

    const storage = useStorage('cache');
    const tsProxyIdentity = toTsProxyIdentity({
      ...query,
      url: normalizedTarget,
      headers: JSON.stringify(customHeaders),
    } as Record<string, any>);
    const tsProxyKeyRaw = `embed:ts-proxy:v3:${path}:${tsProxyIdentity}`;
    const tsProxyCacheKey = `embed:ts-proxy:v3:${hashKey(tsProxyKeyRaw)}`;

    const cachedSegment = await storage
      .getItem<{ contentType: string; bodyBase64: string }>(tsProxyCacheKey)
      .catch(() => null);

    if (cachedSegment?.bodyBase64) {
      logInfo(`Serving from cache (ts-proxy): ${path} key=${tsProxyCacheKey}`);
      setHeader(event, 'content-type', cachedSegment.contentType || 'application/octet-stream');
      setHeader(event, 'x-cache', 'HIT');
      setCORSHeaders(event);
      return Buffer.from(cachedSegment.bodyBase64, 'base64');
    }

    // Use undici for faster proxy with connection pooling
    const pool = getProxyPoolForUrl(normalizedTarget);
    const upstreamResponse = await request(normalizedTarget, {
      method: 'GET',
      headers: customHeaders,
      dispatcher: pool,
      bodyTimeout: 15000,
      headersTimeout: 5000,
    });

    if (upstreamResponse.statusCode !== 200) {
      throw createError({
        statusCode: upstreamResponse.statusCode,
        statusMessage: 'Proxy Error',
      });
    }

    const contentTypeHeader = upstreamResponse.headers['content-type'];
    const contentType = Array.isArray(contentTypeHeader)
      ? contentTypeHeader[0]
      : contentTypeHeader || 'application/octet-stream';
    const maxBytes = getProxyResponseLimit('embed');
    const contentLength = Number(upstreamResponse.headers['content-length'] || 0);
    if (contentLength > maxBytes) {
      await upstreamResponse.body.dump().catch(() => null);
      throw createError({
        statusCode: 413,
        statusMessage: 'Upstream response exceeds the configured size limit',
      });
    }
    const bytes = await readResponseBytesLimited(upstreamResponse.body, maxBytes);

    // Cache TS/segments (max 2MB, 15 min TTL for better UX)
    if (bytes.length <= Math.min(2 * 1024 * 1024, maxBytes)) {
      const ttl = hasSegmentHint ? 15 * 60 : 45; // Increased from 10 to 15 minutes
      await storage
        .setItem(tsProxyCacheKey, { contentType, bodyBase64: bytes.toString('base64') }, { ttl })
        .catch(err => logWarn('Redis write error (ts-proxy):', err));
    }

    setHeader(event, 'content-type', contentType);
    setHeader(event, 'x-cache', 'MISS');
    setCORSHeaders(event);
    return bytes;
  }

  // Nothing else is proxied upstream anymore.
  throw createError({
    statusCode: 404,
    statusMessage: 'Unknown embed path (no upstream configured)',
  });
});
