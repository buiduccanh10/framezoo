import type { Stream } from './types';

interface StreamData {
  masterPlaylistUrl: string;
  referer: string;
  origin: string;
}

type StorageLike = ReturnType<typeof useStorage>;

const VIDSRC_HLS_ORIGIN = process.env.VIDSRC_HLS_ORIGIN || 'tmstr4.shadowlandschronicles.com';
const MODERN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = Number(process.env.VIDSRC_REQUEST_TIMEOUT_MS || 12_000);
const STREAM_CACHE_TTL = Number(process.env.VIDSRC_CACHE_TTL || 5 * 60);
const IMDB_CACHE_TTL = Number(process.env.VIDSRC_IMDB_CACHE_TTL || 24 * 60 * 60);

const IFRAME1_SRC_RE = /<iframe[^>]+src=["']([^"']+)["']/i;
const IFRAME2_SRC_RE = /<iframe[^>]+id=["']player_iframe["'][^>]+src=["']([^"']+)["']/i;
const IFRAME3_SRC_RE = /src:\s*['"](?<url>\/prorcp\/[^'"]+)['"]/i;
const PARAMS_RE = /<div id="(?<id>[^"]+)" style="display:none;">(?<content>[^<]+)<\/div>/;
const FILE_RE = /player_parent.*?file:\s*['"](?<url>[^'"]+)['"].*?cuid/is;
const DIRECT_M3U8_RE = /(https?:\/\/[^'"\s]+\.m3u8[^'"\s]*)/i;

const DECODER2_KEY = 'pWB9V)[*4I`nJpp?ozyB~dbr9yt!_n4u';
const DECODER7_KEY = '3SAY~#%Y(V%>5d/Yg"$G[Lh1rK4a;7ok';

const decryptorMap: Record<string, (value: string) => string> = {
  NdonQLf1Tzyx7bMG: decoder1,
  sXnL9MQIry: decoder2,
  IhWrImMIGL: decoder3,
  KJHidj7det: decoder7,
  Oi3v1dAlaM: value => decoder9(value, 5),
  TsA2KGDGux: value => decoder9(value, 7),
  JoAHUMCLXV: value => decoder9(value, 3),
  eSfH1IRMyL: decoder6,
  o2VSUnjnZl: decoder8,
  xTyBxQyGTA: decoder4,
  ux8qjPHC66: decoder5,
};

const decodeBase64 = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('latin1');
};

const withTimeout = async (url: string, init: RequestInit = {}, timeoutMs: number = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
        'User-Agent': MODERN_UA,
        ...init.headers,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
};

const buildStreamCacheKey = (
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
) =>
  mediaType === 'movie'
    ? `vidsrcto:movie:${tmdbId}`
    : `vidsrcto:tv:${tmdbId}:${seasonNum}:${episodeNum}`;

const buildImdbCacheKey = (mediaType: 'movie' | 'tv', tmdbId: string) =>
  `vidsrcto:imdb:${mediaType}:${tmdbId}`;

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
    // ignore cache errors
  }
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string | null> {
  const response = await withTimeout(url, { headers });
  if (!response.ok) {
    return null;
  }
  return await response.text();
}

function resolveUrl(rawUrl: string, base: string): string {
  return new URL(rawUrl, base).toString();
}

function extractDecodedUrl(thirdHtml: string): string | null {
  const paramsMatch = thirdHtml.match(PARAMS_RE);
  if (!paramsMatch?.groups) {
    const fileMatch = thirdHtml.match(FILE_RE)?.groups?.url;
    if (fileMatch) return normalizeStreamUrl(fileMatch);
    const directMatch = thirdHtml.match(DIRECT_M3U8_RE)?.[1];
    return normalizeStreamUrl(directMatch || '');
  }

  const decoderId = paramsMatch.groups.id;
  const encodedValue = paramsMatch.groups.content;
  const decoder = decryptorMap[decoderId];

  if (!decoder) {
    return null;
  }

  try {
    const decoded = decoder(encodedValue);
    return normalizeStreamUrl(decoded);
  } catch {
    return null;
  }
}

function normalizeStreamUrl(rawValue: string): string | null {
  if (!rawValue) return null;

  const candidates = rawValue
    .split(/\s+or\s+/i)
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => value.replace(/\{v\d+\}/gi, 'shadowlandschronicles.com'));

  for (const candidate of candidates) {
    let url = candidate;
    if (url.startsWith('/')) {
      url = `https://${VIDSRC_HLS_ORIGIN}${url}`;
    }

    if (!/^https?:\/\//i.test(url)) {
      continue;
    }
    if (!url.includes('.m3u8')) {
      continue;
    }
    if (/\s/.test(url)) {
      continue;
    }

    return url;
  }

  return null;
}

async function fetchToken(host: string): Promise<string | null> {
  try {
    const response = await withTimeout(`https://${host}/generate.php`);
    if (!response.ok) return null;
    return (await response.text()).trim();
  } catch {
    return null;
  }
}

async function resolveImdbId(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  storage?: StorageLike
): Promise<string | null> {
  // Allow direct IMDb IDs in API path for diagnostics/manual testing.
  if (/^tt\d+$/i.test(tmdbId)) {
    return tmdbId.toLowerCase();
  }

  const cacheKey = buildImdbCacheKey(mediaType, tmdbId);
  const cached = await getCached<string>(storage, cacheKey);
  if (cached) {
    return cached;
  }

  const config = useRuntimeConfig();
  const tmdbKey = ((config.tmdbApiKey as string | undefined) || process.env.TMDB_API_KEY || '').trim();
  if (!tmdbKey) {
    return null;
  }

  const endpoint = `https://api.themoviedb.org/3/${mediaType}/${encodeURIComponent(
    tmdbId
  )}?append_to_response=external_ids`;
  const query = new URLSearchParams({ language: 'en-US' });
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': MODERN_UA,
  };

  if (tmdbKey.length > 50) {
    headers.Authorization = `Bearer ${tmdbKey}`;
  } else {
    query.set('api_key', tmdbKey);
  }

  const response = await withTimeout(`${endpoint}&${query.toString()}`, { headers }, 8_000);
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as any;
  const imdbId =
    (typeof payload?.imdb_id === 'string' && payload.imdb_id) ||
    (typeof payload?.external_ids?.imdb_id === 'string' && payload.external_ids.imdb_id) ||
    null;

  if (imdbId) {
    await setCached(storage, cacheKey, imdbId, IMDB_CACHE_TTL);
  }

  return imdbId;
}

async function extractVidSrcStream(
  imdbId: string,
  mediaType: 'movie' | 'tv',
  seasonNum?: number | null,
  episodeNum?: number | null
): Promise<StreamData | null> {
  if (mediaType === 'tv' && (seasonNum == null || episodeNum == null)) {
    return null;
  }

  // Use vidsrc.to base URL instead of vidsrc-embed.ru
  const vidsrcToBaseUrl = process.env.VIDSRCTO_BASE_URL || 'https://vidsrc.to';
  
  const firstUrl =
    mediaType === 'movie'
      ? `${vidsrcToBaseUrl}/embed/movie/${encodeURIComponent(imdbId)}`
      : `${vidsrcToBaseUrl}/embed/tv/${encodeURIComponent(imdbId)}/${seasonNum}-${episodeNum}`;

  const firstHtml = await fetchText(firstUrl, {});
  if (!firstHtml) {
    return null;
  }

  const iframe1Match = firstHtml.match(IFRAME1_SRC_RE);
  if (!iframe1Match) return null;
  const secondUrl = iframe1Match[1].startsWith('//') ? 'https:' + iframe1Match[1] : iframe1Match[1];
  const secondOrigin = new URL(secondUrl).origin;

  const secondHtml = await fetchText(secondUrl, {
    Referer: firstUrl,
  });
  if (!secondHtml) return null;

  const iframe2Match = secondHtml.match(IFRAME2_SRC_RE);
  if (!iframe2Match) return null;
  let thirdUrl = iframe2Match[1];
  if (thirdUrl.startsWith('//')) {
    thirdUrl = 'https:' + thirdUrl;
  }

  const thirdHtml = await fetchText(thirdUrl, {
    Referer: secondUrl,
  });
  if (!thirdHtml) return null;

  const thirdRelative = thirdHtml.match(IFRAME3_SRC_RE)?.groups?.url;
  if (!thirdRelative) return null;

  const fourthUrl = resolveUrl(thirdRelative, thirdUrl);
  const fourthOrigin = new URL(thirdUrl).origin;

  const fourthHtml = await fetchText(fourthUrl, {
    Referer: thirdUrl,
  });
  if (!fourthHtml) return null;

  let streamUrl = extractDecodedUrl(fourthHtml);
  if (!streamUrl) return null;

  // Handle token replacement if needed
  if (streamUrl.includes('__TOKEN__')) {
    const host = new URL(streamUrl).host;
    const token = await fetchToken(host);
    if (token) {
      streamUrl = streamUrl.replace('__TOKEN__', token);
    }
  }

  return {
    masterPlaylistUrl: streamUrl,
    referer: thirdUrl,
    origin: fourthOrigin,
  };
}

export async function getVidSrcToStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv' = 'movie',
  seasonNum?: number | null,
  episodeNum?: number | null,
  storage?: StorageLike,
  _context?: { title?: string; releaseYear?: number }
): Promise<Stream[]> {
  try {
    const cacheKey = buildStreamCacheKey(mediaType, tmdbId, seasonNum, episodeNum);
    const cached = await getCached<StreamData>(storage, cacheKey);
    const streamData =
      cached ||
      (await (async () => {
        const imdbId = await resolveImdbId(tmdbId, mediaType, storage);
        const candidateIds = [imdbId, tmdbId].filter((value): value is string => Boolean(value));

        for (const candidateId of candidateIds) {
          const resolved = await extractVidSrcStream(candidateId, mediaType, seasonNum, episodeNum);
          if (resolved) {
            await setCached(storage, cacheKey, resolved, STREAM_CACHE_TTL);
            return resolved;
          }
        }

        return null;
      })());

    if (!streamData) {
      return [];
    }

    return [
      {
        name: 'VidSrc.to - Auto',
        title: 'VidSrc.to - High Quality',
        url: streamData.masterPlaylistUrl,
        subtitle: '',
        quality: '1080p',
        provider: 'vidsrcto',
        headers: {
          Referer: streamData.referer,
          Origin: streamData.origin,
          'User-Agent': MODERN_UA,
        },
      },
    ];
  } catch (error: any) {
    console.error(`[VidSrc.to] Error: ${error?.message || String(error)}`);
    return [];
  }
}

function decoder1(value: string): string {
  const step = 3;
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += step) {
    chunks.push(value.slice(i, i + step));
  }
  return chunks.reverse().join('');
}

function decoder2(value: string): string {
  const key = Array.from(DECODER2_KEY).map(ch => ch.charCodeAt(0));
  const shift = 3;
  const numbers = (value.match(/.{2}/g) || []).map(chunk => Number.parseInt(chunk, 16));
  const decrypted = numbers.map((num, index) => (num ^ key[index % key.length]) - shift);
  return decodeBase64(String.fromCharCode(...decrypted));
}

function decoder3(value: string): string {
  const transformed = Array.from(value)
    .map(ch => {
      if (/[a-mA-M]/.test(ch)) return String.fromCharCode(ch.charCodeAt(0) + 13);
      if (/[n-zN-Z]/.test(ch)) return String.fromCharCode(ch.charCodeAt(0) - 13);
      return ch;
    })
    .join('');
  return decodeBase64(transformed);
}

function decoder4(value: string): string {
  const reversed = value.split('').reverse().join('');
  const filtered = Array.from(reversed)
    .filter((_, index) => index % 2 === 0)
    .join('');
  return decodeBase64(filtered);
}

function decoder5(value: string): string {
  const reversed = value.split('').reverse().join('');
  const shifted = Array.from(reversed)
    .map(ch => String.fromCharCode(ch.charCodeAt(0) - 1))
    .join('');
  return (shifted.match(/.{1,2}/g) || [])
    .map(pair => String.fromCharCode(Number.parseInt(pair, 16)))
    .join('');
}

function decoder6(value: string): string {
  const bytes = Array.from(value)
    .reverse()
    .map(ch => ch.charCodeAt(0) - 1);
  const chunks: number[] = [];
  for (let i = 0; i < bytes.length; i += 2) {
    const high = bytes[i];
    const low = bytes[i + 1];
    if (high == null || low == null) continue;
    chunks.push(Number.parseInt(String.fromCharCode(high, low), 16));
  }
  return Buffer.from(chunks).toString('utf8');
}

function decoder7(value: string): string {
  const trimmed = value.slice(10, -16);
  const key = Array.from(DECODER7_KEY).map(ch => ch.charCodeAt(0));
  const decodedChars = Array.from(decodeBase64(trimmed)).map(ch => ch.charCodeAt(0));
  const decrypted = decodedChars.map((num, index) => num ^ key[index % key.length]);
  return String.fromCharCode(...decrypted);
}

function decoder8(value: string): string {
  const map: Record<string, string> = {};
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  for (let i = 0; i < lower.length; i += 1) {
    map[lower[(i + 23) % 26]] = lower[i];
    map[upper[(i + 23) % 26]] = upper[i];
  }

  return Array.from(value)
    .map(ch => map[ch] || ch)
    .join('');
}

function decoder9(value: string, shift: number): string {
  const transformed = value
    .split('')
    .reverse()
    .map(ch => (ch === '-' ? '+' : ch === '_' ? '/' : ch))
    .join('');
  const decoded = Array.from(decodeBase64(transformed)).map(ch => ch.charCodeAt(0) - shift);
  return String.fromCharCode(...decoded);
}
