import {
  buildPreviewAssetKey,
  buildPreviewAutoResource,
  buildPreviewFileResource,
  parsePreviewAutoResource,
} from '~/utils/preview';
import { getProvider } from '~/providers/registry';
import { applyCorsHeaders } from '~/utils/cors';
import {
  acquireProxySlot,
  assertSafeUpstreamUrl,
  buildProxyRequestUrl,
  fetchWithTimeout,
  getProxyResponseLimit,
  getProxyUpstreamTimeoutMs,
  readWebResponseBytesLimited,
  requireProxyAccess,
} from '~/utils/proxySecurity';

const PREVIEW_SERVICE_URL = process.env.PREVIEW_SERVICE_URL || 'http://127.0.0.1:3100';
const PREVIEW_BACKEND_INTERNAL_BASE_URL =
  process.env.PREVIEW_BACKEND_INTERNAL_BASE_URL || 'http://127.0.0.1:3000';
const PREVIEW_SERVICE_TIMEOUT_MS = Number(process.env.PREVIEW_SERVICE_TIMEOUT_MS || 300_000);

const setPreviewHeaders = (event: any) => {
  applyCorsHeaders(event, 'GET, OPTIONS, HEAD', '*');
  setHeader(event, 'cache-control', 'public, max-age=300, s-maxage=1800');
};

const fetchGeneratedVtt = async (key: string) => {
  const fileAbort = new AbortController();
  const fileTimeout = setTimeout(() => fileAbort.abort(), PREVIEW_SERVICE_TIMEOUT_MS);

  try {
    const response = await fetchWithTimeout(
      `${PREVIEW_SERVICE_URL}/files/${encodeURIComponent(key)}/index.vtt`,
      { method: 'GET', signal: fileAbort.signal },
      Math.min(PREVIEW_SERVICE_TIMEOUT_MS, getProxyUpstreamTimeoutMs())
    );

    if (!response.ok) {
      return {
        ok: false as const,
        status: response.status,
      };
    }

    const bytes = await readWebResponseBytesLimited(response, getProxyResponseLimit('preview'));
    return {
      ok: true as const,
      payload: bytes.toString('utf8'),
    };
  } finally {
    clearTimeout(fileTimeout);
  }
};

const rewriteGeneratedVtt = (payload: string, origin: string, key: string) => {
  return payload
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim();
      if (
        !trimmed ||
        trimmed === 'WEBVTT' ||
        trimmed.startsWith('NOTE') ||
        trimmed.includes('-->')
      ) {
        return line;
      }

      if (/^\d+$/.test(trimmed)) {
        return line;
      }

      const match = trimmed.match(/^([^#\s]+\.(?:avif|webp|png|jpe?g))(#.*)?$/i);
      if (!match) {
        return line;
      }

      const [, fileName, fragment = ''] = match;
      const proxied = buildProxyRequestUrl(
        origin,
        '/api/preview/file',
        'preview-file',
        '',
        {},
        buildPreviewFileResource(key, fileName)
      );
      return line.replace(trimmed, `${proxied}${fragment}`);
    })
    .join('\n');
};

export default defineEventHandler(async event => {
  if (event.method === 'OPTIONS') {
    setPreviewHeaders(event);
    return null;
  }

  const query = getQuery(event);
  const resource = typeof query.resource === 'string' ? query.resource : '';
  const parsedResource = resource ? parsePreviewAutoResource(resource) : null;
  const providerName =
    parsedResource?.provider || (typeof query.provider === 'string' ? query.provider : '');
  const mediaType =
    parsedResource?.mediaType ||
    (query.type === 'tv' ? 'tv' : query.type === 'movie' ? 'movie' : '');
  const tmdbId = parsedResource?.tmdbId || (typeof query.tmdbId === 'string' ? query.tmdbId : '');
  const season =
    parsedResource?.season ??
    (typeof query.season === 'string' ? Number.parseInt(query.season, 10) : null);
  const episode =
    parsedResource?.episode ??
    (typeof query.episode === 'string' ? Number.parseInt(query.episode, 10) : null);

  if (
    !providerName ||
    providerName.length > 64 ||
    !mediaType ||
    !/^\d{1,20}$/.test(tmdbId) ||
    (mediaType === 'tv' &&
      (!Number.isInteger(season) ||
        !Number.isInteger(episode) ||
        season < 1 ||
        episode < 1 ||
        season > 1000 ||
        episode > 1000))
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Missing provider, type, or tmdbId' });
  }

  const provider = getProvider(providerName);
  if (!provider) {
    throw createError({ statusCode: 404, statusMessage: `Provider '${providerName}' not found` });
  }

  if (mediaType === 'tv' && (!season || !episode)) {
    throw createError({ statusCode: 400, statusMessage: 'Season and episode are required for TV' });
  }

  const storage = useStorage('cache');
  const key = buildPreviewAssetKey({
    provider: providerName,
    mediaType,
    tmdbId,
    season,
    episode,
  });
  const origin = getRequestURL(event).origin;
  await requireProxyAccess(event, {
    kind: 'preview-auto',
    resource:
      resource ||
      buildPreviewAutoResource({
        provider: providerName,
        mediaType,
        tmdbId,
        season,
        episode,
      }),
  });

  const existingVtt = await fetchGeneratedVtt(key);
  if (existingVtt.ok) {
    const rewrittenVtt = rewriteGeneratedVtt(existingVtt.payload, origin, key);
    setHeader(event, 'content-type', 'text/vtt; charset=utf-8');
    setPreviewHeaders(event);
    return rewrittenVtt;
  }

  const releaseProxySlot = acquireProxySlot();
  try {
    let sourceUrl = await storage.getItem<string>(`preview-source:${key}`).catch(() => null);
    if (sourceUrl) {
      try {
        const parsed = new URL(sourceUrl);
        if (!parsed.searchParams.get('capability')) {
          sourceUrl = null;
          await storage.removeItem(`preview-source:${key}`).catch(() => null);
        }
      } catch {
        sourceUrl = null;
        await storage.removeItem(`preview-source:${key}`).catch(() => null);
      }
    }

    if (!sourceUrl) {
      const contextCacheKey = `stream-meta:${providerName}:${mediaType}:${tmdbId}${mediaType === 'tv' ? `:${season}:${episode}` : ''}`;
      const streamContext = await storage
        .getItem<{
          title?: string;
          originName?: string;
          releaseYear?: number;
          country?: string;
        }>(contextCacheKey)
        .catch(() => null);
      const streams = await provider.getStreams(tmdbId, mediaType, season, episode, storage, {
        title: streamContext?.title,
        originName: streamContext?.originName,
        releaseYear: streamContext?.releaseYear,
        country: streamContext?.country,
      });
      const stream = streams[0];
      if (!stream?.url) {
        throw createError({
          statusCode: 404,
          statusMessage: 'No stream available to generate preview',
        });
      }

      const proxyPath = stream.streamType === 'file' ? '/api/media-proxy' : '/api/m3u8-proxy';
      const proxyKind = stream.streamType === 'file' ? 'media' : 'm3u8';
      const safeStreamUrl = await assertSafeUpstreamUrl(stream.url).catch(() => {
        throw createError({
          statusCode: 502,
          statusMessage: 'Provider returned an unsafe stream URL',
        });
      });
      sourceUrl = buildProxyRequestUrl(
        PREVIEW_BACKEND_INTERNAL_BASE_URL,
        proxyPath,
        proxyKind,
        safeStreamUrl,
        stream.headers || {}
      );

      await storage.setItem(`preview-source:${key}`, sourceUrl, { ttl: 60 * 60 }).catch(() => null);
    }

    let generateResponse: Response;
    const generateAbort = new AbortController();
    const generateTimeout = setTimeout(() => generateAbort.abort(), PREVIEW_SERVICE_TIMEOUT_MS);
    try {
      generateResponse = await fetch(`${PREVIEW_SERVICE_URL}/generate`, {
        method: 'POST',
        signal: generateAbort.signal,
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          key,
          sourceUrl,
        }),
      });
    } catch (error: any) {
      await storage.removeItem(`preview-source:${key}`).catch(() => null);
      throw createError({
        statusCode: 502,
        statusMessage: 'Preview generator unavailable',
      });
    } finally {
      clearTimeout(generateTimeout);
    }

    if (!generateResponse.ok) {
      await storage.removeItem(`preview-source:${key}`).catch(() => null);
      const errorText = await readWebResponseBytesLimited(generateResponse, 64 * 1024)
        .then(bytes => bytes.toString('utf8'))
        .catch(() => '');
      throw createError({
        statusCode: 502,
        statusMessage: 'Preview generator failed',
      });
    }

    const generatedVtt = await fetchGeneratedVtt(key);
    if (!generatedVtt.ok) {
      await storage.removeItem(`preview-source:${key}`).catch(() => null);
      throw createError({
        statusCode: generatedVtt.status || 502,
        statusMessage: 'Preview VTT file is not available',
      });
    }

    const rewrittenVtt = rewriteGeneratedVtt(generatedVtt.payload, origin, key);

    setHeader(event, 'content-type', 'text/vtt; charset=utf-8');
    setPreviewHeaders(event);
    return rewrittenVtt;
  } finally {
    releaseProxySlot();
  }
});
