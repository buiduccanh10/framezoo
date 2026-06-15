import { createHmac, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Stream } from './types';

type StorageLike = ReturnType<typeof useStorage>;

type ImgDataModule = {
  initSync: (options: { module: Buffer }) => unknown;
  get_img_key: () => string;
  process_img_data: (payload: string, apiKey: string) => Promise<unknown>;
};

interface StreamData {
  masterPlaylistUrl: string;
  referer: string;
  origin: string;
}

interface RuntimeState {
  module: ImgDataModule;
  apiKey: string;
}

const SITE_BASE_URL = process.env.VIDSRC_RU_BASE_URL || 'https://vidsrc.ru';
const TMDB_BASE_URL = process.env.VIDSRC_RU_TMDB_BASE_URL || 'https://themoviedb.vidsrc.su';
const SITE_ORIGIN = new URL(SITE_BASE_URL).origin;
const TMDB_ORIGIN = new URL(TMDB_BASE_URL).origin;
const FINGERPRINT_LITE_HEADER =
  process.env.VIDSRC_RU_FINGERPRINT_LITE || 'e9136c41504646444';
const MODERN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = Number(process.env.VIDSRC_RU_REQUEST_TIMEOUT_MS || 12_000);
const STREAM_CACHE_TTL = Number(process.env.VIDSRC_RU_CACHE_TTL || 5 * 60);
const SERVER_TIME_CACHE_TTL_MS = Number(process.env.VIDSRC_RU_SERVER_TIME_TTL_MS || 5 * 60 * 1000);
const TMDB_ID_CACHE_TTL = Number(process.env.VIDSRC_RU_TMDB_ID_CACHE_TTL || 24 * 60 * 60);

const runtimeDir = join(tmpdir(), 'betamovie-vidsrc-ru-runtime');
const runtimeJsPath = join(runtimeDir, 'img_data.js');
const runtimeWasmPath = join(runtimeDir, 'img_data_bg.wasm');

let runtimePromise: Promise<RuntimeState> | null = null;
let cachedServerTime: { value: number; fetchedAt: number } | null = null;

class BrowserWindow {}

class BrowserCanvasContext2D {
  font = '10px sans-serif';
  textBaseline = 'top';

  fillText(_text: string, _x: number, _y: number) {
    return undefined;
  }
}

class BrowserCanvasElement {
  width = 300;
  height = 150;
  private readonly context = new BrowserCanvasContext2D();

  getContext(contextType: string) {
    return contextType === '2d' ? this.context : null;
  }

  toDataURL() {
    return 'data:image/png;base64,AAAA';
  }
}

const withTimeout = async (
  url: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

function defineGlobalValue(key: string, value: unknown) {
  const globalRecord = globalThis as Record<string, unknown>;
  if (globalRecord[key] != null) {
    return;
  }

  try {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  } catch {
    globalRecord[key] = value;
  }
}

function ensureBrowserLikeGlobals() {
  defineGlobalValue('Window', BrowserWindow);
  defineGlobalValue('HTMLCanvasElement', BrowserCanvasElement);
  defineGlobalValue('CanvasRenderingContext2D', BrowserCanvasContext2D);

  const windowValue = ((globalThis as Record<string, any>).window as any) || new BrowserWindow();
  windowValue.localStorage ||= {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  windowValue.screen ||= { width: 1920, height: 1080, colorDepth: 24 };
  windowValue.location ||= {
    href: `${SITE_ORIGIN}/movie/299534`,
    hostname: new URL(SITE_ORIGIN).hostname,
    host: new URL(SITE_ORIGIN).host,
    protocol: new URL(SITE_ORIGIN).protocol,
    pathname: '/movie/299534',
  };
  windowValue.navigator ||= {
    userAgent: MODERN_UA,
    platform: 'MacIntel',
    language: 'en-US',
    webdriver: false,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    plugins: { length: 3, namedItem: (name: string) => ({ name }) },
  };
  windowValue.performance ||= { now: () => Date.now() };
  windowValue.queueMicrotask ||= queueMicrotask;
  windowValue.top = windowValue;
  windowValue.parent = windowValue;
  windowValue.self = windowValue;
  windowValue.document ||= {};
  windowValue.document.body ||= {};
  windowValue.document.createElement ||= (tag: string) => {
    if (tag === 'canvas') {
      return new BrowserCanvasElement();
    }
    return {};
  };
  windowValue.document.getElementsByTagName ||= (tag: string) => {
    if (tag === 'script') {
      return [
        { src: `${SITE_ORIGIN}/assets/index.js` },
        { src: `${TMDB_ORIGIN}/assets/client/tmdb-image-enhancer.js` },
      ];
    }
    if (tag === 'body') {
      return [windowValue.document.body];
    }
    return [];
  };

  defineGlobalValue('window', windowValue);
  defineGlobalValue('self', windowValue);
  defineGlobalValue('document', windowValue.document);
  defineGlobalValue('screen', windowValue.screen);
  defineGlobalValue('localStorage', windowValue.localStorage);
  defineGlobalValue('navigator', windowValue.navigator);
  defineGlobalValue('chrome', { runtime: {} });
}

async function downloadRuntimeAssets() {
  await mkdir(runtimeDir, { recursive: true });

  const [jsResponse, wasmResponse] = await Promise.all([
    withTimeout(`${TMDB_ORIGIN}/assets/wasm/img_data.js`, {
      headers: {
        Accept: 'application/javascript,text/plain,*/*',
        'User-Agent': MODERN_UA,
      },
    }),
    withTimeout(`${TMDB_ORIGIN}/assets/wasm/img_data_bg.wasm`, {
      headers: {
        Accept: 'application/wasm,*/*',
        'User-Agent': MODERN_UA,
      },
    }),
  ]);

  if (!jsResponse.ok) {
    throw new Error(`Failed to fetch runtime JS: ${jsResponse.status}`);
  }
  if (!wasmResponse.ok) {
    throw new Error(`Failed to fetch runtime WASM: ${wasmResponse.status}`);
  }

  const [jsText, wasmBuffer] = await Promise.all([jsResponse.text(), wasmResponse.arrayBuffer()]);
  await Promise.all([writeFile(runtimeJsPath, jsText), writeFile(runtimeWasmPath, Buffer.from(wasmBuffer))]);
}

async function getRuntime(): Promise<RuntimeState> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      ensureBrowserLikeGlobals();
      await downloadRuntimeAssets();

      const moduleUrl = `${pathToFileURL(runtimeJsPath).href}?t=${Date.now()}`;
      const runtimeModule = (await import(moduleUrl)) as unknown as ImgDataModule;
      const wasmBytes = await readFile(runtimeWasmPath);
      runtimeModule.initSync({ module: wasmBytes });

      const apiKey = runtimeModule.get_img_key();
      if (typeof apiKey !== 'string' || apiKey.length !== 64) {
        throw new Error('Invalid Vidsrc.ru api key generated from runtime');
      }

      return {
        module: runtimeModule,
        apiKey,
      };
    })().catch(error => {
      runtimePromise = null;
      throw error;
    });
  }

  return await runtimePromise;
}

const buildStreamCacheKey = (
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
) =>
  mediaType === 'movie'
    ? `vidsrc-ru:movie:${tmdbId}`
    : `vidsrc-ru:tv:${tmdbId}:${seasonNum}:${episodeNum}`;

const buildTmdbIdCacheKey = (mediaType: 'movie' | 'tv', id: string) =>
  `vidsrc-ru:tmdb-id:${mediaType}:${id.toLowerCase()}`;

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

function normalizeApiPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    const pathMatch = url.match(/\/api\/tmdb\/.*/);
    return pathMatch?.[0] || url;
  }
}

function generateNonce(): string {
  return randomBytes(16)
    .toString('base64')
    .replace(/[\/=+]/g, '')
    .slice(0, 22);
}

function generateClientFingerprint(): string {
  const screen = (globalThis as Record<string, any>).screen || {
    width: 1920,
    height: 1080,
    colorDepth: 24,
  };
  const navigator = (globalThis as Record<string, any>).navigator || {
    userAgent: MODERN_UA,
    platform: 'MacIntel',
    language: 'en-US',
  };
  const document = (globalThis as Record<string, any>).document as Record<string, any>;
  const canvas = document?.createElement?.('canvas') as BrowserCanvasElement | undefined;
  const context = canvas?.getContext?.('2d');

  if (context && typeof context.fillText === 'function') {
    context.fillText('FP', 2, 2);
  }

  const snippet = (canvas?.toDataURL?.() || 'data:image/png;base64,AAAA').substring(22, 50);
  const base = `${screen.width}x${screen.height}:${screen.colorDepth}:${String(navigator.userAgent || MODERN_UA).substring(0, 50)}:${navigator.platform || 'MacIntel'}:${navigator.language || 'en-US'}:${new Date().getTimezoneOffset()}:${snippet}`;

  let hash = 0;
  for (let index = 0; index < base.length; index += 1) {
    hash = (hash << 5) - hash + base.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

async function getServerTimestamp(): Promise<number> {
  const now = Date.now();
  if (cachedServerTime && now - cachedServerTime.fetchedAt < SERVER_TIME_CACHE_TTL_MS) {
    return cachedServerTime.value;
  }

  const response = await withTimeout(`${TMDB_ORIGIN}/api/time?t=${now}`, {
    headers: {
      'Cache-Control': 'no-cache',
      Referer: `${SITE_ORIGIN}/`,
      Origin: SITE_ORIGIN,
      'User-Agent': MODERN_UA,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch server time: ${response.status}`);
  }

  const payload = (await response.json()) as { timestamp?: number };
  const timestamp = Number(payload?.timestamp);
  if (!Number.isFinite(timestamp)) {
    throw new Error('Invalid server time payload');
  }

  cachedServerTime = {
    value: timestamp,
    fetchedAt: now,
  };

  return timestamp;
}

async function buildSignedHeaders(apiKey: string, targetUrl: string): Promise<Record<string, string>> {
  const timestamp = await getServerTimestamp();
  const nonce = generateNonce();
  const targetPath = normalizeApiPath(targetUrl);
  const signatureInput = `${apiKey}:${timestamp}:${nonce}:${targetPath}`;
  const signature = createHmac('sha256', apiKey).update(signatureInput).digest('base64');

  return {
    'X-Api-Key': apiKey,
    'X-Request-Timestamp': String(timestamp),
    'X-Request-Nonce': nonce,
    'X-Request-Signature': signature,
    'X-Client-Fingerprint': generateClientFingerprint(),
  };
}

async function requestDecryptedPayload(
  runtime: RuntimeState,
  endpoint: string,
  extraHeaders: Record<string, string> = {}
): Promise<any> {
  const signedHeaders = await buildSignedHeaders(runtime.apiKey, endpoint);
  const response = await withTimeout(endpoint, {
    headers: {
      Accept: 'text/plain',
      'Accept-Language': 'en-US,en;q=0.9',
      Origin: SITE_ORIGIN,
      Referer: `${SITE_ORIGIN}/`,
      'User-Agent': MODERN_UA,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'x-fingerprint-lite': FINGERPRINT_LITE_HEADER,
      ...extraHeaders,
      ...signedHeaders,
    },
  });

  if (!response.ok) {
    return null;
  }

  const encryptedText = await response.text();
  if (!encryptedText) {
    return null;
  }

  const decryptedRaw = await runtime.module.process_img_data(encryptedText, runtime.apiKey);
  if (typeof decryptedRaw !== 'string' || !decryptedRaw.trim()) {
    return null;
  }

  return JSON.parse(decryptedRaw);
}

function extractServers(payload: any): string[] {
  const names = new Set<string>();

  if (Array.isArray(payload?.sources)) {
    for (const source of payload.sources) {
      if (typeof source?.server === 'string' && source.server.trim()) {
        names.add(source.server.trim().toLowerCase());
      }
    }
  }

  if (payload?.servers && typeof payload.servers === 'object') {
    for (const key of Object.keys(payload.servers)) {
      if (key.trim()) {
        names.add(key.trim().toLowerCase());
      }
    }
  }

  return [...names];
}

function extractSourceUrl(payload: any, serverName: string): string | null {
  if (Array.isArray(payload?.sources)) {
    const matched =
      payload.sources.find(
        (entry: any) =>
          typeof entry?.server === 'string' &&
          entry.server.toLowerCase() === serverName &&
          typeof entry?.url === 'string' &&
          entry.url
      ) ||
      payload.sources.find((entry: any) => typeof entry?.url === 'string' && entry.url);

    if (typeof matched?.url === 'string') {
      return matched.url;
    }
  }

  if (typeof payload?.sources?.file === 'string' && payload.sources.file) {
    return payload.sources.file;
  }

  if (typeof payload?.sources?.url === 'string' && payload.sources.url) {
    return payload.sources.url;
  }

  return null;
}

function normalizeSourceUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.toString();
  } catch {
    return null;
  }
}

function isM3u8Url(url: string): boolean {
  return /\.m3u8(?:$|[?#])/i.test(url);
}

function isValidStreamData(streamData: StreamData | null | undefined): streamData is StreamData {
  if (!streamData) {
    return false;
  }

  const normalizedUrl = normalizeSourceUrl(streamData.masterPlaylistUrl);
  return Boolean(normalizedUrl && isM3u8Url(normalizedUrl));
}

async function resolveTmdbId(
  id: string,
  mediaType: 'movie' | 'tv',
  storage?: StorageLike
): Promise<string | null> {
  const normalized = String(id || '').trim();
  if (!normalized) {
    return null;
  }
  if (/^\d+$/.test(normalized)) {
    return normalized;
  }
  if (!/^tt\d+$/i.test(normalized)) {
    return normalized;
  }

  const cacheKey = buildTmdbIdCacheKey(mediaType, normalized);
  const cached = await getCached<string>(storage, cacheKey);
  if (cached && /^\d+$/.test(cached)) {
    return cached;
  }

  const endpoint = `${TMDB_ORIGIN}/api/tmdb/find/${encodeURIComponent(
    normalized
  )}?external_source=imdb_id`;
  const response = await withTimeout(endpoint, {
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      Referer: `${SITE_ORIGIN}/`,
      Origin: SITE_ORIGIN,
      'User-Agent': MODERN_UA,
    },
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const payload = (await response.json()) as any;
  const candidates = mediaType === 'movie' ? payload?.movie_results : payload?.tv_results;
  const resolved =
    Array.isArray(candidates) &&
    candidates.find((entry: any) => Number.isFinite(Number(entry?.id)) && Number(entry.id) > 0);
  const resolvedId =
    resolved && Number.isFinite(Number(resolved.id)) && Number(resolved.id) > 0
      ? String(resolved.id)
      : null;

  if (resolvedId) {
    await setCached(storage, cacheKey, resolvedId, TMDB_ID_CACHE_TTL);
  }

  return resolvedId;
}

async function resolveStream(
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  seasonNum?: number | null,
  episodeNum?: number | null,
  storage?: StorageLike
): Promise<StreamData | null> {
  if (mediaType === 'tv' && (seasonNum == null || episodeNum == null)) {
    return null;
  }

  const resolvedTmdbId = await resolveTmdbId(tmdbId, mediaType, storage);
  if (!resolvedTmdbId) {
    return null;
  }

  const endpoint =
    mediaType === 'movie'
      ? `${TMDB_ORIGIN}/api/tmdb/movie/${encodeURIComponent(resolvedTmdbId)}/images`
      : `${TMDB_ORIGIN}/api/tmdb/tv/${encodeURIComponent(resolvedTmdbId)}/season/${seasonNum}/episode/${episodeNum}/images`;

  const runtime = await getRuntime();
  const initialPayload = await requestDecryptedPayload(runtime, endpoint, { bW90aGFmYWth: '1' }).catch(
    () => null
  );

  const servers = extractServers(initialPayload);
  for (const server of servers) {
    const sourcePayload = await requestDecryptedPayload(runtime, endpoint, {
      'X-Only-Sources': '1',
      'X-Server': server,
    }).catch(() => null);

    const sourceUrl = extractSourceUrl(sourcePayload, server);
    if (!sourceUrl || typeof sourceUrl !== 'string') {
      continue;
    }

    const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
    if (!normalizedSourceUrl) {
      continue;
    }
    if (!isM3u8Url(normalizedSourceUrl)) {
      continue;
    }

    return {
      masterPlaylistUrl: normalizedSourceUrl,
      referer: `${SITE_ORIGIN}/`,
      origin: SITE_ORIGIN,
    };
  }

  return null;
}

export async function getVidsrcRuStreams(
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
    const streamData = isValidStreamData(cached)
      ? cached
      : await resolveStream(mediaType, tmdbId, seasonNum, episodeNum, storage);

    if (!streamData) {
      return [];
    }

    await setCached(storage, cacheKey, streamData, STREAM_CACHE_TTL);

    return [
      {
        name: 'VidSrc.ru - Auto',
        title: 'VidSrc.ru - High Quality',
        url: streamData.masterPlaylistUrl,
        subtitle: '',
        quality: '1080p',
        provider: 'vidsrc-ru',
        headers: {
          Referer: streamData.referer,
          Origin: streamData.origin,
          'User-Agent': MODERN_UA,
        },
      },
    ];
  } catch (error: any) {
    console.error(`[VidsrcRu] Error: ${error?.message || String(error)}`);
    return [];
  }
}
