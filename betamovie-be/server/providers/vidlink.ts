/**
 * Vidlink streaming provider integration.
 * Uses vidlink's wasm runtime to derive secure token (getAdv) from TMDB id,
 * then resolves the final HLS master playlist from /api/b/* endpoints.
 */

import type { Stream } from './types';

interface StreamData {
  masterPlaylistUrl: string;
  referer: string;
  origin: string;
}

type StorageLike = ReturnType<typeof useStorage>;

type DmInstance = {
  importObject: WebAssembly.Imports;
  run: (instance: WebAssembly.Instance) => Promise<void>;
};

type DmConstructor = new () => DmInstance;

type GetAdvFn = (id: string) => string | null;

type SodiumModule = {
  ready: Promise<void>;
};

const BASE_URL = process.env.VIDLINK_BASE_URL || 'https://vidlink.pro';
const BASE_ORIGIN = new URL(BASE_URL).origin;
const REFERER = `${BASE_ORIGIN}/`;
const MODERN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const STREAM_CACHE_TTL_MS = 5 * 60 * 1000;
const STREAM_CACHE_TTL = Math.floor(STREAM_CACHE_TTL_MS / 1000);
const WASM_BOOT_WAIT_MS = Number(process.env.VIDLINK_BOOT_WAIT_MS || 500);

let wasmReady = false;
let bootPromise: Promise<void> | null = null;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getGlobalValue = <T>(key: string): T | undefined => {
  const value = (globalThis as Record<string, unknown>)[key];
  return value as T | undefined;
};

function setGlobalValue(key: string, value: unknown): void {
  (globalThis as Record<string, unknown>)[key] = value;
}

function ensureVidlinkGlobals(): void {
  if (!getGlobalValue('window')) {
    setGlobalValue('window', globalThis);
  }

  if (!getGlobalValue('self')) {
    setGlobalValue('self', globalThis);
  }

  if (!getGlobalValue('document')) {
    setGlobalValue('document', {
      createElement: () => ({}),
      body: { appendChild: () => undefined },
    });
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Referer: REFERER,
      Origin: BASE_ORIGIN,
      'User-Agent': MODERN_UA,
      Accept: 'application/javascript,text/plain,*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.text();
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    headers: {
      Referer: REFERER,
      Origin: BASE_ORIGIN,
      'User-Agent': MODERN_UA,
      Accept: 'application/wasm,*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.arrayBuffer();
}

function getDmConstructor(): DmConstructor {
  const Dm = getGlobalValue<DmConstructor>('Dm');
  if (typeof Dm !== 'function') {
    throw new Error('Vidlink runtime (Dm) was not loaded');
  }
  return Dm;
}

function getAdvFunction(): GetAdvFn {
  const getAdv = getGlobalValue<GetAdvFn>('getAdv');
  if (typeof getAdv !== 'function') {
    throw new Error('Vidlink runtime (getAdv) was not initialized');
  }
  return getAdv;
}

async function bootVidlinkRuntime(): Promise<void> {
  if (wasmReady && typeof getGlobalValue<GetAdvFn>('getAdv') === 'function') {
    return;
  }

  if (!bootPromise) {
    bootPromise = (async () => {
      ensureVidlinkGlobals();

      const sodiumImport = await import('libsodium-wrappers');
      const sodiumMaybeDefault = (sodiumImport as { default?: SodiumModule }).default;
      const sodium = (sodiumMaybeDefault || sodiumImport) as unknown as SodiumModule;
      await sodium.ready;
      setGlobalValue('sodium', sodium);

      const [scriptSource, wasmBytes] = await Promise.all([
        fetchText(`${BASE_ORIGIN}/script.js`),
        fetchBuffer(`${BASE_ORIGIN}/fu.wasm`),
      ]);

      // Vidlink script defines Dm on global scope via an IIFE.
      (0, eval)(scriptSource);

      const Dm = getDmConstructor();
      const go = new Dm();
      const { instance } = await WebAssembly.instantiate(wasmBytes, go.importObject);
      // go.run() is expected to keep runtime alive; do not await here.
      void go.run(instance);

      await sleep(WASM_BOOT_WAIT_MS);
      getAdvFunction();
      wasmReady = true;
    })()
      .catch(error => {
        wasmReady = false;
        throw error;
      })
      .finally(() => {
        if (!wasmReady) {
          bootPromise = null;
        }
      });
  }

  await bootPromise;
}

function buildStreamCacheKey(
  contentType: 'movie' | 'tv',
  contentId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
): string {
  return contentType === 'movie'
    ? `vidlink:movie:${contentId}`
    : `vidlink:tv:${contentId}:${seasonNum}:${episodeNum}`;
}

async function getCachedStream(cacheKey: string, storage: StorageLike): Promise<StreamData | null> {
  try {
    const cached = await storage.getItem<StreamData>(cacheKey);
    return cached || null;
  } catch {
    return null;
  }
}

async function setCachedStream(
  cacheKey: string,
  value: StreamData,
  storage: StorageLike
): Promise<void> {
  try {
    await storage.setItem(cacheKey, value, { ttl: STREAM_CACHE_TTL });
  } catch (error) {
    console.warn('[Vidlink] Failed to cache stream:', error);
  }
}

async function removeCachedStream(cacheKey: string, storage: StorageLike): Promise<void> {
  try {
    await storage.removeItem(cacheKey);
  } catch {
    // Ignore cache removal failures.
  }
}

function buildVidlinkApiUrl(
  contentType: 'movie' | 'tv',
  token: string,
  seasonNum?: number | null,
  episodeNum?: number | null
): string {
  if (contentType === 'movie') {
    return `${BASE_ORIGIN}/api/b/movie/${encodeURIComponent(token)}?multiLang=0`;
  }

  return `${BASE_ORIGIN}/api/b/tv/${encodeURIComponent(token)}/${seasonNum}/${episodeNum}?multiLang=0`;
}

function normalizeM3u8Url(rawUrl: string): string | null {
  const value = String(rawUrl || '').trim();
  if (!value || /\s/.test(value)) return null;

  try {
    const parsed = new URL(value);
    const normalized = parsed.toString();
    return /\.m3u8(?:$|[?#])/i.test(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function extractFirstMediaLine(playlist: string): string | null {
  for (const line of playlist.split(/\r?\n/).map(value => value.trim())) {
    if (!line || line.startsWith('#') || line.startsWith('<')) continue;
    return line;
  }
  return null;
}

function resolvePlaylistStreamData(rawPlaylistUrl: string): StreamData | null {
  const normalizedUrl = normalizeM3u8Url(rawPlaylistUrl);
  if (!normalizedUrl) return null;

  let resolvedUrl = normalizedUrl;
  let referer = REFERER;
  let origin = BASE_ORIGIN;

  try {
    const parsed = new URL(normalizedUrl);
    const headersRaw = parsed.searchParams.get('headers');
    if (headersRaw) {
      try {
        const parsedHeaders = JSON.parse(headersRaw) as Record<string, unknown>;
        const refererHeader =
          typeof parsedHeaders.referer === 'string'
            ? parsedHeaders.referer
            : typeof parsedHeaders.Referer === 'string'
              ? parsedHeaders.Referer
              : '';
        const originHeader =
          typeof parsedHeaders.origin === 'string'
            ? parsedHeaders.origin
            : typeof parsedHeaders.Origin === 'string'
              ? parsedHeaders.Origin
              : '';

        if (refererHeader) {
          referer = refererHeader;
        }
        if (originHeader) {
          origin = originHeader;
        } else if (refererHeader) {
          try {
            origin = new URL(refererHeader).origin;
          } catch {
            // keep fallback origin
          }
        }
      } catch {
        // keep default headers
      }
    }

    const hostRaw = parsed.searchParams.get('host');
    const encodedProxyPath = parsed.pathname.startsWith('/proxy/')
      ? parsed.pathname.slice('/proxy/'.length)
      : '';
    if (hostRaw && encodedProxyPath) {
      try {
        const hostOrigin = new URL(hostRaw).origin;
        const decodedPath = decodeURIComponent(encodedProxyPath);
        const directUrl = new URL(decodedPath, hostOrigin).toString();
        const directNormalized = normalizeM3u8Url(directUrl);
        if (directNormalized) {
          resolvedUrl = directNormalized;
        }
      } catch {
        // keep original normalized URL
      }
    }
  } catch {
    // keep normalized URL/default headers
  }

  return {
    masterPlaylistUrl: resolvedUrl,
    referer,
    origin,
  };
}

async function verifyPlayableStream(streamData: StreamData): Promise<boolean> {
  const requestHeaders = {
    Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*',
    Referer: streamData.referer,
    Origin: streamData.origin,
    'User-Agent': MODERN_UA,
  };

  const playlistResponse = await fetch(streamData.masterPlaylistUrl, {
    headers: requestHeaders,
  }).catch(() => null);
  if (!playlistResponse?.ok) {
    return false;
  }

  const playlistText = await playlistResponse.text().catch(() => '');
  if (!playlistText || !playlistText.includes('#EXTM3U')) {
    return false;
  }

  const firstLine = extractFirstMediaLine(playlistText);
  if (!firstLine) {
    return false;
  }

  let segmentUrl = new URL(firstLine, streamData.masterPlaylistUrl).toString();
  if (/\.m3u8(?:$|[?#])/i.test(segmentUrl)) {
    const childResponse = await fetch(segmentUrl, {
      headers: requestHeaders,
    }).catch(() => null);
    if (!childResponse?.ok) {
      return false;
    }

    const childText = await childResponse.text().catch(() => '');
    const childFirstLine = extractFirstMediaLine(childText);
    if (!childFirstLine) {
      return false;
    }
    segmentUrl = new URL(childFirstLine, segmentUrl).toString();
  }

  const segmentResponse = await fetch(segmentUrl, {
    headers: {
      ...requestHeaders,
      Accept: '*/*',
      Range: 'bytes=0-65535',
    },
  }).catch(() => null);
  if (!segmentResponse?.ok) {
    return false;
  }

  const bytes = await segmentResponse.arrayBuffer().catch(() => null);
  return Boolean(bytes && bytes.byteLength > 0);
}

async function extractStreamFromApi(
  contentType: 'movie' | 'tv',
  contentId: string,
  seasonNum?: number | null,
  episodeNum?: number | null,
  storage?: StorageLike
): Promise<StreamData | null> {
  if (storage) {
    const cacheKey = buildStreamCacheKey(contentType, contentId, seasonNum, episodeNum);
    const cached = await getCachedStream(cacheKey, storage);
    if (cached && (await verifyPlayableStream(cached))) {
      return cached;
    }
    if (cached) {
      await removeCachedStream(cacheKey, storage);
    }
  }

  await bootVidlinkRuntime();
  const getAdv = getAdvFunction();
  const token = getAdv(contentId);

  if (!token) {
    console.warn(`[Vidlink] getAdv returned empty token for TMDB ${contentId}`);
    return null;
  }

  const apiUrl = buildVidlinkApiUrl(contentType, token, seasonNum, episodeNum);
  const response = await fetch(apiUrl, {
    headers: {
      Referer: REFERER,
      Origin: BASE_ORIGIN,
      'User-Agent': MODERN_UA,
      Accept: 'application/json,text/plain,*/*',
    },
  });

  if (!response.ok) {
    console.warn(`[Vidlink] API returned ${response.status} for ${apiUrl}`);
    return null;
  }

  const rawPayload = await response.text();
  if (!rawPayload) {
    console.warn(`[Vidlink] Empty payload from API for TMDB ${contentId}`);
    return null;
  }

  let parsedPayload: any;
  try {
    parsedPayload = JSON.parse(rawPayload);
  } catch {
    console.warn(`[Vidlink] Invalid JSON payload for TMDB ${contentId}`);
    return null;
  }

  const playlistUrl =
    parsedPayload?.stream?.playlist || parsedPayload?.stream?.hls || parsedPayload?.playlist;

  if (!playlistUrl || typeof playlistUrl !== 'string') {
    console.warn(`[Vidlink] Missing playlist URL for TMDB ${contentId}`);
    return null;
  }

  const result = resolvePlaylistStreamData(playlistUrl);
  if (!result) {
    console.warn(`[Vidlink] Invalid playlist URL for TMDB ${contentId}`);
    return null;
  }
  if (!(await verifyPlayableStream(result))) {
    console.warn(`[Vidlink] Rejected non-playable stream for TMDB ${contentId}`);
    return null;
  }

  if (storage) {
    const cacheKey = buildStreamCacheKey(contentType, contentId, seasonNum, episodeNum);
    await setCachedStream(cacheKey, result, storage);
  }

  return result;
}

export async function getVidlinkStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv' = 'movie',
  seasonNum?: number | null,
  episodeNum?: number | null,
  storage?: StorageLike,
  _context?: { title?: string; releaseYear?: number }
): Promise<Stream[]> {
  try {
    const streamData = await extractStreamFromApi(
      mediaType,
      tmdbId,
      seasonNum,
      episodeNum,
      storage
    );
    if (!streamData) {
      return [];
    }

    return [
      {
        name: 'Vidlink - Auto',
        title: 'Vidlink - High Quality',
        url: streamData.masterPlaylistUrl,
        subtitle: '',
        quality: '1080p',
        provider: 'vidlink',
        headers: {
          Referer: streamData.referer,
          'User-Agent': MODERN_UA,
          Origin: streamData.origin,
        },
      },
    ];
  } catch (error: any) {
    console.error(`[Vidlink] Error: ${error.message || String(error)}`);
    return [];
  }
}
