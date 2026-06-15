import type { Stream } from './types';

/**
 * Vixsrc streaming provider integration.
 * Primary path: call the public /api/movie|tv endpoints, follow the returned /embed URL,
 * and extract window.masterPlaylist from the embed page.
 * Legacy fallback: use the old wasm/runtime flow or parse HTML directly.
 */

interface StreamData {
  masterPlaylistUrl: string;
  referer: string;
}

type StorageLike = ReturnType<typeof useStorage>;

type DmInstance = {
  importObject: WebAssembly.Imports;
  run: (instance: WebAssembly.Instance) => Promise<void>;
};

type DmConstructor = new () => DmInstance;
type GetAdvFn = (id: string) => string | null;
type SodiumModule = { ready: Promise<void> };

const BASE_URL = process.env.VIXSRC_BASE_URL || 'https://vixsrc.to';
const BASE_ORIGIN = new URL(BASE_URL).origin;
const REFERER = `${BASE_ORIGIN}/`;
const MODERN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const STREAM_CACHE_TTL_MS = 5 * 60 * 1000;
const STREAM_CACHE_TTL = Math.floor(STREAM_CACHE_TTL_MS / 1000);
const WASM_BOOT_WAIT_MS = Number(process.env.VIXSRC_BOOT_WAIT_MS || 500);
const FAST_PATH_RETRY_COOLDOWN_MS = Number(process.env.VIXSRC_FASTPATH_RETRY_MS || 5 * 60 * 1000);
const ENABLE_RUNTIME_FAST_PATH = process.env.VIXSRC_RUNTIME_FAST_PATH !== '0';

const WINDOW_MASTER_PLAYLIST_RE = /window\.masterPlaylist\s*=\s*(\{[\s\S]*?\})(?:;|\s|$)/;
const OBJECT_URL_RE = /['"]?url['"]?\s*:\s*['"]([^'"]+)['"]/;
const OBJECT_TOKEN_RE = /['"]?token['"]?\s*:\s*['"]([^'"]+)['"]/;
const OBJECT_EXPIRES_RE = /['"]?expires['"]?\s*:\s*['"]([^'"]+)['"]/;
const EMBED_SRC_RE = /["']src["']\s*:\s*["']([^"']+)["']/;
const DIRECT_M3U8_RE = /(https?:\/\/[^'"\s]+\.m3u8[^'"\s]*)/;
const SCRIPT_STREAM_RE = /['"]?(https?:\/\/[^'"\s]+(?:\.m3u8|playlist)[^'"\s]*)/;
const SCRIPT_TAG_RE = /<script[^>]*>(.*?)<\/script>/gs;

let wasmReady = false;
let bootPromise: Promise<void> | null = null;
let nextBootAttemptAt = 0;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getGlobalValue = <T>(key: string): T | undefined => {
  const value = (globalThis as Record<string, unknown>)[key];
  return value as T | undefined;
};

function setGlobalValue(key: string, value: unknown): void {
  (globalThis as Record<string, unknown>)[key] = value;
}

function ensureRuntimeGlobals(): void {
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

function getDmConstructor(): DmConstructor {
  const Dm = getGlobalValue<DmConstructor>('Dm');
  if (typeof Dm !== 'function') {
    throw new Error('Vixsrc runtime (Dm) was not loaded');
  }
  return Dm;
}

function getAdvFunction(): GetAdvFn {
  const getAdv = getGlobalValue<GetAdvFn>('getAdv');
  if (typeof getAdv !== 'function') {
    throw new Error('Vixsrc runtime (getAdv) was not initialized');
  }
  return getAdv;
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

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': MODERN_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate',
      Connection: 'keep-alive',
      Referer: REFERER,
      Origin: BASE_ORIGIN,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.text();
}

async function bootVixsrcRuntime(): Promise<boolean> {
  if (!ENABLE_RUNTIME_FAST_PATH) {
    return false;
  }

  const now = Date.now();
  if (now < nextBootAttemptAt) {
    return false;
  }

  if (wasmReady && typeof getGlobalValue<GetAdvFn>('getAdv') === 'function') {
    return true;
  }

  if (!bootPromise) {
    bootPromise = (async () => {
      ensureRuntimeGlobals();

      const sodiumImport = await import('libsodium-wrappers');
      const sodiumMaybeDefault = (sodiumImport as { default?: SodiumModule }).default;
      const sodium = (sodiumMaybeDefault || sodiumImport) as unknown as SodiumModule;
      await sodium.ready;
      setGlobalValue('sodium', sodium);

      const [scriptSource, wasmBytes] = await Promise.all([
        fetchText(`${BASE_ORIGIN}/script.js`),
        fetchBuffer(`${BASE_ORIGIN}/fu.wasm`),
      ]);

      // Runtime script defines Dm/getAdv in global scope via IIFE.
      (0, eval)(scriptSource);

      const Dm = getDmConstructor();
      const go = new Dm();
      const { instance } = await WebAssembly.instantiate(wasmBytes, go.importObject);
      void go.run(instance);

      await sleep(WASM_BOOT_WAIT_MS);
      getAdvFunction();

      wasmReady = true;
      nextBootAttemptAt = 0;
    })()
      .catch(error => {
        wasmReady = false;
        nextBootAttemptAt = Date.now() + FAST_PATH_RETRY_COOLDOWN_MS;
        console.warn(`[Vixsrc] Runtime fast-path unavailable: ${error.message || String(error)}`);
      })
      .finally(() => {
        bootPromise = null;
      });
  }

  await bootPromise;
  return wasmReady;
}

function buildPageUrl(
  contentType: 'movie' | 'tv',
  contentId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
): string | null {
  if (contentType === 'movie') {
    return `${BASE_ORIGIN}/movie/${contentId}`;
  }

  if (seasonNum == null || episodeNum == null) {
    return null;
  }

  return `${BASE_ORIGIN}/tv/${contentId}/${seasonNum}/${episodeNum}`;
}

function buildModernApiUrl(
  contentType: 'movie' | 'tv',
  contentId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
): string | null {
  if (contentType === 'movie') {
    return `${BASE_ORIGIN}/api/movie/${encodeURIComponent(contentId)}`;
  }

  if (seasonNum == null || episodeNum == null) {
    return null;
  }

  return `${BASE_ORIGIN}/api/tv/${encodeURIComponent(contentId)}/${seasonNum}/${episodeNum}`;
}

function buildApiUrl(
  contentType: 'movie' | 'tv',
  token: string,
  seasonNum?: number | null,
  episodeNum?: number | null
): string | null {
  if (contentType === 'movie') {
    return `${BASE_ORIGIN}/api/b/movie/${encodeURIComponent(token)}?multiLang=0`;
  }

  if (seasonNum == null || episodeNum == null) {
    return null;
  }

  return `${BASE_ORIGIN}/api/b/tv/${encodeURIComponent(token)}/${seasonNum}/${episodeNum}?multiLang=0`;
}

function buildStreamCacheKey(
  contentType: 'movie' | 'tv',
  contentId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
): string {
  return contentType === 'movie'
    ? `vixsrc:movie:${contentId}`
    : `vixsrc:tv:${contentId}:${seasonNum}:${episodeNum}`;
}

function buildPlaylistUrl(baseUrl: string, token: string, expires: string): string {
  return baseUrl.includes('?')
    ? `${baseUrl}&token=${token}&expires=${expires}&h=1&lang=en`
    : `${baseUrl}?token=${token}&expires=${expires}&h=1&lang=en`;
}

function extractMasterPlaylistFromHtml(html: string): string | null {
  if (html.includes('window.masterPlaylist')) {
    const matchedSection = html.match(WINDOW_MASTER_PLAYLIST_RE);
    const scriptContent = matchedSection ? matchedSection[1] : html;

    const urlMatch = scriptContent.match(OBJECT_URL_RE);
    const tokenMatch = scriptContent.match(OBJECT_TOKEN_RE);
    const expiresMatch = scriptContent.match(OBJECT_EXPIRES_RE);

    if (urlMatch && tokenMatch && expiresMatch) {
      return buildPlaylistUrl(urlMatch[1], tokenMatch[1], expiresMatch[1]);
    }
  }

  const m3u8Match = html.match(DIRECT_M3U8_RE);
  if (m3u8Match) {
    return m3u8Match[1];
  }

  const scriptMatches = html.match(SCRIPT_TAG_RE);
  if (scriptMatches) {
    for (const script of scriptMatches) {
      const streamMatch = script.match(SCRIPT_STREAM_RE);
      if (streamMatch) {
        return streamMatch[1];
      }
    }
  }

  return null;
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
    console.warn('[Vixsrc] Failed to cache stream:', error);
  }
}

async function extractStreamFromModernApi(
  contentType: 'movie' | 'tv',
  contentId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
): Promise<StreamData | null> {
  const apiUrl = buildModernApiUrl(contentType, contentId, seasonNum, episodeNum);
  if (!apiUrl) {
    return null;
  }

  try {
    const response = await fetch(apiUrl, {
      headers: {
        Referer: REFERER,
        Origin: BASE_ORIGIN,
        'User-Agent': MODERN_UA,
        Accept: 'application/json,text/plain,*/*',
      },
    });

    if (!response.ok) {
      return null;
    }

    const rawPayload = await response.text();
    if (!rawPayload) {
      return null;
    }

    let embedPath: string | null = null;

    try {
      const parsedPayload = JSON.parse(rawPayload);
      if (typeof parsedPayload?.src === 'string') {
        embedPath = parsedPayload.src;
      }
    } catch {
      const embedMatch = rawPayload.match(EMBED_SRC_RE);
      embedPath = embedMatch?.[1] || null;
    }

    if (!embedPath) {
      return null;
    }

    const embedUrl = new URL(embedPath, BASE_ORIGIN).toString();
    const embedHtml = await fetchHtml(embedUrl);
    const masterPlaylistUrl = extractMasterPlaylistFromHtml(embedHtml);

    if (!masterPlaylistUrl) {
      return null;
    }

    return {
      masterPlaylistUrl,
      referer: REFERER,
    };
  } catch (error: any) {
    console.warn(`[Vixsrc] Modern API extraction failed: ${error.message || String(error)}`);
    return null;
  }
}

async function extractStreamFromApi(
  contentType: 'movie' | 'tv',
  contentId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
): Promise<StreamData | null> {
  const runtimeReady = await bootVixsrcRuntime();
  if (!runtimeReady) {
    return null;
  }

  try {
    const getAdv = getAdvFunction();
    const token = getAdv(contentId);

    if (!token) {
      console.warn(`[Vixsrc] getAdv returned empty token for TMDB ${contentId}`);
      return null;
    }

    const apiUrl = buildApiUrl(contentType, token, seasonNum, episodeNum);
    if (!apiUrl) {
      return null;
    }

    const response = await fetch(apiUrl, {
      headers: {
        Referer: REFERER,
        Origin: BASE_ORIGIN,
        'User-Agent': MODERN_UA,
        Accept: 'application/json,text/plain,*/*',
      },
    });

    if (!response.ok) {
      return null;
    }

    const rawPayload = await response.text();
    if (!rawPayload) {
      return null;
    }

    let parsedPayload: any;
    try {
      parsedPayload = JSON.parse(rawPayload);
    } catch {
      return null;
    }

    const playlistUrl =
      parsedPayload?.stream?.playlist || parsedPayload?.stream?.hls || parsedPayload?.playlist;

    if (!playlistUrl || typeof playlistUrl !== 'string') {
      return null;
    }

    return {
      masterPlaylistUrl: playlistUrl,
      referer: REFERER,
    };
  } catch (error: any) {
    console.warn(`[Vixsrc] Runtime API extraction failed: ${error.message || String(error)}`);
    return null;
  }
}

async function extractStreamFromPage(
  contentType: 'movie' | 'tv',
  contentId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
): Promise<StreamData | null> {
  const pageUrl = buildPageUrl(contentType, contentId, seasonNum, episodeNum);
  if (!pageUrl) {
    return null;
  }

  try {
    const html = await fetchHtml(pageUrl);
    if (!html || html.length < 500) {
      return null;
    }

    const masterPlaylistUrl = extractMasterPlaylistFromHtml(html);

    if (!masterPlaylistUrl) {
      return null;
    }

    return { masterPlaylistUrl, referer: pageUrl };
  } catch (error: any) {
    console.error(`[Vixsrc] HTML extraction failed: ${error.message || String(error)}`);
    return null;
  }
}

async function extractStream(
  contentType: 'movie' | 'tv',
  contentId: string,
  seasonNum?: number | null,
  episodeNum?: number | null,
  storage?: StorageLike
): Promise<StreamData | null> {
  let cacheKey: string | null = null;

  if (storage) {
    cacheKey = buildStreamCacheKey(contentType, contentId, seasonNum, episodeNum);
    const cached = await getCachedStream(cacheKey, storage);
    if (cached) {
      return cached;
    }
  }

  const fromModernApi = await extractStreamFromModernApi(
    contentType,
    contentId,
    seasonNum,
    episodeNum
  );
  if (fromModernApi) {
    if (storage && cacheKey) {
      await setCachedStream(cacheKey, fromModernApi, storage);
    }
    return fromModernApi;
  }

  const fromRuntime = await extractStreamFromApi(contentType, contentId, seasonNum, episodeNum);
  if (fromRuntime) {
    if (storage && cacheKey) {
      await setCachedStream(cacheKey, fromRuntime, storage);
    }
    return fromRuntime;
  }

  const fromHtml = await extractStreamFromPage(contentType, contentId, seasonNum, episodeNum);
  if (fromHtml && storage && cacheKey) {
    await setCachedStream(cacheKey, fromHtml, storage);
  }

  return fromHtml;
}

export async function getVixsrcStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv' = 'movie',
  seasonNum?: number | null,
  episodeNum?: number | null,
  storage?: StorageLike,
  _context?: { title?: string; releaseYear?: number }
): Promise<Stream[]> {
  try {
    const streamData = await extractStream(mediaType, tmdbId, seasonNum, episodeNum, storage);
    if (!streamData) {
      return [];
    }

    return [
      {
        name: 'Vixsrc - Auto',
        title: 'Vixsrc - High Quality',
        url: streamData.masterPlaylistUrl,
        subtitle: '',
        quality: '1080p',
        provider: 'vixsrc',
        headers: {
          Referer: streamData.referer,
          'User-Agent': MODERN_UA,
          Origin: BASE_ORIGIN,
        },
      },
    ];
  } catch (error: any) {
    console.error(`[Vixsrc] Error: ${error.message || String(error)}`);
    return [];
  }
}
