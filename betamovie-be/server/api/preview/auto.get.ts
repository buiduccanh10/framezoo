import { buildPreviewAssetKey } from '~/utils/preview';
import { getProvider } from '~/providers/registry';
import { applyCorsHeaders } from '~/utils/cors';

const PREVIEW_SERVICE_URL = process.env.PREVIEW_SERVICE_URL || 'http://127.0.0.1:3100';
const PREVIEW_BACKEND_INTERNAL_BASE_URL =
  process.env.PREVIEW_BACKEND_INTERNAL_BASE_URL || 'http://127.0.0.1:3000';
const PREVIEW_SERVICE_TIMEOUT_MS = Number(process.env.PREVIEW_SERVICE_TIMEOUT_MS || 130_000);
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN?.trim() || '';

const withInternalToken = (url: string) => {
  if (!INTERNAL_API_TOKEN) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('internalToken', INTERNAL_API_TOKEN);
    return parsed.toString();
  } catch {
    return url;
  }
};

const setPreviewHeaders = (event: any) => {
  applyCorsHeaders(event, 'GET, OPTIONS, HEAD', '*');
  setHeader(event, 'cache-control', 'public, max-age=300, s-maxage=1800');
};

const fetchGeneratedVtt = async (key: string) => {
  const fileAbort = new AbortController();
  const fileTimeout = setTimeout(() => fileAbort.abort(), PREVIEW_SERVICE_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${PREVIEW_SERVICE_URL}/files/${encodeURIComponent(key)}/index.vtt`,
      {
        signal: fileAbort.signal,
      }
    );

    if (!response.ok) {
      return {
        ok: false as const,
        status: response.status,
      };
    }

    return {
      ok: true as const,
      payload: await response.text(),
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
      const proxied = `${origin}/api/preview/file?key=${encodeURIComponent(key)}&file=${encodeURIComponent(fileName)}`;
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
  const providerName = typeof query.provider === 'string' ? query.provider : '';
  const mediaType = query.type === 'tv' ? 'tv' : query.type === 'movie' ? 'movie' : '';
  const tmdbId = typeof query.tmdbId === 'string' ? query.tmdbId : '';
  const season = typeof query.season === 'string' ? Number.parseInt(query.season, 10) : null;
  const episode = typeof query.episode === 'string' ? Number.parseInt(query.episode, 10) : null;

  if (!providerName || !mediaType || !tmdbId) {
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

  const existingVtt = await fetchGeneratedVtt(key);
  if (existingVtt.ok) {
    const rewrittenVtt = rewriteGeneratedVtt(existingVtt.payload, origin, key);
    setHeader(event, 'content-type', 'text/vtt; charset=utf-8');
    setPreviewHeaders(event);
    return rewrittenVtt;
  }

  let sourceUrl = await storage.getItem<string>(`preview-source:${key}`).catch(() => null);
  if (sourceUrl) {
    const normalized = withInternalToken(sourceUrl);
    if (normalized !== sourceUrl) {
      sourceUrl = normalized;
      await storage.setItem(`preview-source:${key}`, sourceUrl, { ttl: 60 * 60 }).catch(() => null);
    }
  }

  if (!sourceUrl) {
    const contextCacheKey = `stream-meta:${providerName}:${mediaType}:${tmdbId}${mediaType === 'tv' ? `:${season}:${episode}` : ''}`;
    const streamContext = await storage
      .getItem<{ title?: string; releaseYear?: number }>(contextCacheKey)
      .catch(() => null);
    const streams = await provider.getStreams(tmdbId, mediaType, season, episode, storage, {
      title: streamContext?.title,
      releaseYear: streamContext?.releaseYear,
    });
    const stream = streams[0];
    if (!stream?.url) {
      throw createError({
        statusCode: 404,
        statusMessage: 'No stream available to generate preview',
      });
    }

    sourceUrl =
      `${PREVIEW_BACKEND_INTERNAL_BASE_URL}/api/m3u8-proxy?url=${encodeURIComponent(stream.url)}` +
      `&headers=${encodeURIComponent(JSON.stringify(stream.headers || {}))}`;
    sourceUrl = withInternalToken(sourceUrl);

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
      statusMessage: `Preview generator unavailable: ${error?.message || String(error)}`,
    });
  } finally {
    clearTimeout(generateTimeout);
  }

  if (!generateResponse.ok) {
    await storage.removeItem(`preview-source:${key}`).catch(() => null);
    const errorText = await generateResponse.text().catch(() => '');
    throw createError({
      statusCode: 502,
      statusMessage: `Preview generator failed: ${errorText || generateResponse.statusText}`,
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
});
