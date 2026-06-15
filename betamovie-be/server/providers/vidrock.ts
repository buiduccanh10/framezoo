import { webcrypto } from 'node:crypto';
import type { Stream } from './types';

type StorageLike = ReturnType<typeof useStorage>;

interface VidrockStreamInfo {
  url: string | null;
  language: string | null;
  flag?: string | null;
  type?: string | null;
}

type VidrockStreams = Record<string, VidrockStreamInfo>;

interface VidrockCdnStream {
  resolution?: string | number;
  url?: string;
}

interface StreamData {
  masterPlaylistUrl: string;
  referer: string;
  origin: string;
  quality: string;
  language: string;
  serverName: string;
}

const BASE_URL = process.env.VIDROCK_BASE_URL || 'https://vidrock.net/';
const BASE_ORIGIN = new URL(BASE_URL).origin;
const REFERER = `${BASE_ORIGIN}/`;
const PROXY_PREFIX = 'https://proxy.vidrock.store/';
const PASSPHRASE = 'x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9';
const MODERN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36';
const REQUEST_TIMEOUT_MS = Number(process.env.VIDROCK_REQUEST_TIMEOUT_MS || 12_000);
const STREAM_CACHE_TTL = Number(process.env.VIDROCK_CACHE_TTL || 5 * 60);
const STREAM_CACHE_VERSION = 'v1';
const MAX_CDN_STREAMS_TO_TRY = Math.max(1, Number(process.env.VIDROCK_MAX_CDN_STREAMS || 5));

const withTimeout = async (
  url: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const getHeaders = (referer = REFERER, origin = REFERER): Record<string, string> => ({
  'User-Agent': MODERN_UA,
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: referer,
  Origin: origin,
});

function buildStreamCacheKey(
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
) {
  return mediaType === 'movie'
    ? `vidrock:${STREAM_CACHE_VERSION}:movie:${tmdbId}`
    : `vidrock:${STREAM_CACHE_VERSION}:tv:${tmdbId}:${seasonNum}:${episodeNum}`;
}

async function getCached<T>(storage: StorageLike | undefined, key: string): Promise<T | null> {
  if (!storage) return null;

  try {
    return (await storage.getItem<T>(key)) || null;
  } catch {
    return null;
  }
}

async function setCached<T>(
  storage: StorageLike | undefined,
  key: string,
  value: T,
  ttl: number
): Promise<void> {
  if (!storage) return;

  try {
    await storage.setItem(key, value as any, { ttl });
  } catch {
    // Ignore cache failures.
  }
}

async function encryptItemId(itemId: string): Promise<string> {
  const textEncoder = new TextEncoder();
  const keyData = textEncoder.encode(PASSPHRASE);
  const iv = textEncoder.encode(PASSPHRASE.substring(0, 16));
  const key = await webcrypto.subtle.importKey('raw', keyData, { name: 'AES-CBC' }, false, [
    'encrypt',
  ]);
  const encrypted = await webcrypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    key,
    textEncoder.encode(itemId)
  );

  return Buffer.from(new Uint8Array(encrypted))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function buildApiUrl(
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
): Promise<string | null> {
  if (mediaType === 'tv' && (seasonNum == null || episodeNum == null)) {
    return null;
  }

  const itemId = mediaType === 'tv' ? `${tmdbId}_${seasonNum}_${episodeNum}` : String(tmdbId);
  const encrypted = await encryptItemId(itemId);
  return `${BASE_ORIGIN}/api/${mediaType}/${encrypted}`;
}

async function requestJson<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  const response = await withTimeout(url, { headers }).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  return await response.json().catch(() => null);
}

function normalizeM3u8Url(rawUrl: string): string | null {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  try {
    const parsed = new URL(normalized);
    const value = parsed.toString();
    return /\.m3u8(?:$|[?#])/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

function decodeProxyUrl(rawUrl: string): string {
  if (!rawUrl.startsWith(PROXY_PREFIX)) {
    return rawUrl;
  }

  const encodedPath = rawUrl.slice(PROXY_PREFIX.length);
  return decodeURIComponent(encodedPath.replace(/^\/+/, ''));
}

async function resolveCdnStreams(
  url: string,
  stream: VidrockStreamInfo,
  serverName: string
): Promise<StreamData[]> {
  const cdnStreams = await requestJson<VidrockCdnStream[]>(url, getHeaders());
  if (!Array.isArray(cdnStreams)) {
    return [];
  }

  return cdnStreams
    .slice(0, MAX_CDN_STREAMS_TO_TRY)
    .map(item => {
      const finalUrl =
        typeof item?.url === 'string' ? normalizeM3u8Url(decodeProxyUrl(item.url)) : null;
      if (!finalUrl) {
        return null;
      }

      return {
        masterPlaylistUrl: finalUrl,
        referer: 'https://lok-lok.cc/',
        origin: 'https://lok-lok.cc/',
        quality: item.resolution ? `${item.resolution}p` : '1080p',
        language: stream.language || 'Unknown',
        serverName,
      } satisfies StreamData;
    })
    .filter((item): item is StreamData => Boolean(item));
}

async function resolveStreams(
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
): Promise<StreamData[]> {
  const apiUrl = await buildApiUrl(mediaType, tmdbId, seasonNum, episodeNum);
  if (!apiUrl) {
    return [];
  }

  const payload = await requestJson<VidrockStreams>(apiUrl, getHeaders());
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const candidates: StreamData[] = [];
  for (const [serverName, stream] of Object.entries(payload)) {
    if (!stream?.url) {
      continue;
    }

    if (stream.url.includes('hls2.vdrk.site')) {
      candidates.push(...(await resolveCdnStreams(stream.url, stream, serverName)));
      continue;
    }

    const masterPlaylistUrl = normalizeM3u8Url(stream.url);
    if (!masterPlaylistUrl) {
      continue;
    }

    candidates.push({
      masterPlaylistUrl,
      referer: REFERER,
      origin: REFERER,
      quality: '1080p',
      language: stream.language || 'Unknown',
      serverName,
    });
  }

  return candidates;
}

export async function getVidrockStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv' = 'movie',
  seasonNum?: number | null,
  episodeNum?: number | null,
  storage?: StorageLike,
  _context?: { title?: string; releaseYear?: number }
): Promise<Stream[]> {
  try {
    const cacheKey = buildStreamCacheKey(mediaType, tmdbId, seasonNum, episodeNum);
    const cached = await getCached<StreamData[]>(storage, cacheKey);
    const streamData = cached?.length
      ? cached
      : await resolveStreams(mediaType, tmdbId, seasonNum, episodeNum);

    if (!streamData.length) {
      return [];
    }

    await setCached(storage, cacheKey, streamData, STREAM_CACHE_TTL);

    return streamData.map(stream => ({
      name: `Vidrock - ${stream.serverName}`,
      title: `Vidrock - ${stream.quality}${stream.language ? ` (${stream.language})` : ''}`,
      url: stream.masterPlaylistUrl,
      subtitle: '',
      quality: stream.quality,
      provider: 'vidrock',
      headers: {
        Referer: stream.referer,
        Origin: stream.origin,
        'User-Agent': MODERN_UA,
      },
    }));
  } catch (error: any) {
    console.error(`[Vidrock] Error: ${error?.message || String(error)}`);
    return [];
  }
}
