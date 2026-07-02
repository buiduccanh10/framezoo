import { Buffer } from 'node:buffer';
import { createDecipheriv, createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { parse } from 'acorn';
import type { Stream } from './types';

type StorageLike = ReturnType<typeof useStorage>;

interface VidkingRuntimeModule {
  serve(): string | null;
  verify(value: string): boolean;
  decrypt(value: string, id: number): string | null;
}

interface VidkingRuntimeState {
  module: VidkingRuntimeModule;
  verificationHash: string;
}

interface VidkingMetadata {
  title: string;
  year: number;
  imdbId: string;
}

interface VidkingSourceEntry {
  quality?: string;
  url?: string;
}

interface VidkingSubtitleEntry {
  url?: string;
  file?: string;
  lang?: string;
  language?: string;
}

interface VidkingPayload {
  sources?: VidkingSourceEntry[];
  subtitles?: VidkingSubtitleEntry[];
}

interface ResolvedStreamData {
  masterPlaylistUrl: string;
  referer: string;
  origin: string;
  quality: string;
  subtitle: string;
}

const SITE_BASE_URL = process.env.VIDKING_BASE_URL || 'https://www.vidking.net';
const SITE_ORIGIN = new URL(SITE_BASE_URL).origin;
const REFERER = `${SITE_ORIGIN}/`;
const API_ORIGIN = 'https://api.videasy.to';
const TMDB_ORIGIN = 'https://db.videasy.to/3';
const MODERN_UA =
  process.env.VIDKING_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = Number(process.env.VIDKING_REQUEST_TIMEOUT_MS || 18_000);
const RUNTIME_BOOT_TIMEOUT_MS = Number(process.env.VIDKING_BOOT_TIMEOUT_MS || 20_000);
const STREAM_CACHE_TTL = Number(process.env.VIDKING_CACHE_TTL || 5 * 60);
const CACHE_VERSION = 2;

const SERVER_ENDPOINTS = [
  { name: 'Oxygen', endpoint: 'mb-flix/sources-with-title' },
  { name: 'Hydrogen', endpoint: 'cdn/sources-with-title' },
  { name: 'Lithium', endpoint: 'downloader2/sources-with-title' },
  { name: 'Helium', endpoint: '1movies/sources-with-title' },
] as const;

let runtimePromise: Promise<VidkingRuntimeState> | null = null;

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

function buildStreamCacheKey(
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
) {
  return mediaType === 'movie'
    ? `vidking:v${CACHE_VERSION}:movie:${tmdbId}`
    : `vidking:v${CACHE_VERSION}:tv:${tmdbId}:${seasonNum}:${episodeNum}`;
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

async function fetchText(url: string, headers: HeadersInit = {}): Promise<string | null> {
  const response = await withTimeout(
    url,
    {
      headers: {
        Accept: 'text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        Referer: REFERER,
        Origin: SITE_ORIGIN,
        'User-Agent': MODERN_UA,
        ...headers,
      },
    },
    REQUEST_TIMEOUT_MS
  ).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  return await response.text().catch(() => null);
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await withTimeout(
    url,
    {
      headers: {
        Accept: 'application/json,text/plain,*/*',
        Referer: REFERER,
        Origin: SITE_ORIGIN,
        'User-Agent': MODERN_UA,
      },
    },
    REQUEST_TIMEOUT_MS
  ).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  return await response.json().catch(() => null);
}

function normalizeHttpUrl(rawUrl: string): string | null {
  const value = String(rawUrl || '').trim();
  if (!value || /\s/.test(value)) {
    return null;
  }

  const normalized = value.startsWith('//') ? `https:${value}` : value;

  try {
    const parsed = new URL(normalized);
    return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeM3u8Url(rawUrl: string): string | null {
  const normalized = normalizeHttpUrl(rawUrl);
  return normalized && /\.m3u8(?:$|[?#])/i.test(normalized) ? normalized : null;
}

function normalizeQuality(rawQuality: string | undefined): string {
  const value = String(rawQuality || '').trim();
  if (!value) {
    return 'auto';
  }

  const match = value.match(/(\d{3,4})/);
  return match ? `${match[1]}p` : value;
}

function qualityScore(quality: string): number {
  const match = quality.match(/(\d{3,4})/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function looksLikeEncryptedHex(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 100 && /^[0-9a-f]+$/i.test(normalized);
}

function evpBytesToKey(password: string, salt: Buffer, keyLen: number, ivLen: number) {
  let result = Buffer.alloc(0);
  let previous = Buffer.alloc(0);
  const pass = Buffer.from(password, 'utf8');

  while (result.length < keyLen + ivLen) {
    previous = createHash('md5')
      .update(Buffer.concat([previous, pass, salt]))
      .digest();
    result = Buffer.concat([result, previous]);
  }

  return {
    key: result.subarray(0, keyLen),
    iv: result.subarray(keyLen, keyLen + ivLen),
  };
}

function decryptOpenSslBase64(ciphertextBase64: string, password = ''): string {
  const data = Buffer.from(ciphertextBase64, 'base64');
  if (data.subarray(0, 8).toString() !== 'Salted__') {
    throw new Error('Vidking AES payload is missing OpenSSL salt header');
  }

  const salt = data.subarray(8, 16);
  const encrypted = data.subarray(16);
  const { key, iv } = evpBytesToKey(password, salt, 32, 16);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function createVidkingWasmWrapper(exports: WebAssembly.Exports, memory: WebAssembly.Memory) {
  const wasmExports = exports as WebAssembly.Exports & {
    __new: (size: number, id: number) => number;
    serve: () => number;
    verify: (value: number) => number;
    decrypt: (value: number, id: number) => number;
  };

  function readString(pointer: number): string | null {
    if (!pointer) return null;

    const end = (pointer + new Uint32Array(memory.buffer)[(pointer - 4) >>> 2]) >>> 1;
    const view = new Uint16Array(memory.buffer);
    let index = pointer >>> 1;
    let value = '';

    for (; end - index > 1024; ) {
      value += String.fromCharCode(...view.subarray(index, (index += 1024)));
    }

    return value + String.fromCharCode(...view.subarray(index, end));
  }

  function writeString(value: string | null): number {
    if (value == null) {
      throw new TypeError('value must not be null');
    }

    const pointer = wasmExports.__new(value.length << 1, 2) >>> 0;
    const view = new Uint16Array(memory.buffer);

    for (let index = 0; index < value.length; index += 1) {
      view[(pointer >>> 1) + index] = value.charCodeAt(index);
    }

    return pointer;
  }

  return {
    serve(): string | null {
      return readString(wasmExports.serve() >>> 0);
    },
    verify(value: string): boolean {
      return wasmExports.verify(writeString(value)) !== 0;
    },
    decrypt(value: string, id: number): string | null {
      return readString(wasmExports.decrypt(writeString(value), id) >>> 0);
    },
  } satisfies VidkingRuntimeModule;
}

async function instantiateVidkingRuntimeModule(wasmUrl: string): Promise<VidkingRuntimeModule> {
  const module = await WebAssembly.compileStreaming(
    withTimeout(
      wasmUrl,
      {
        headers: {
          Accept: 'application/wasm,*/*',
          Referer: REFERER,
          Origin: SITE_ORIGIN,
          'User-Agent': MODERN_UA,
        },
      },
      REQUEST_TIMEOUT_MS
    ),
  );

  const env = Object.assign(Object.create(globalThis), {
    seed() {
      return Date.now() * Math.random();
    },
    abort(messagePtr: number, filePtr: number, line: number, column: number) {
      const readAbortString = (pointer: number) => {
        if (!pointer) return '';
        const mem = currentMemory ?? env.memory;
        if (!mem) return '';

        const end = (pointer + new Uint32Array(mem.buffer)[(pointer - 4) >>> 2]) >>> 1;
        const view = new Uint16Array(mem.buffer);
        let index = pointer >>> 1;
        let value = '';

        for (; end - index > 1024; ) {
          value += String.fromCharCode(...view.subarray(index, (index += 1024)));
        }

        return value + String.fromCharCode(...view.subarray(index, end));
      };

      throw new Error(
        `${readAbortString(messagePtr >>> 0)} in ${readAbortString(filePtr >>> 0)}:${line >>> 0}:${
          column >>> 0
        }`
      );
    },
  }) as WebAssembly.Imports['env'] & { memory?: WebAssembly.Memory };

  let currentMemory: WebAssembly.Memory | null = null;
  const { exports } = await WebAssembly.instantiate(module, {
    env,
  });
  currentMemory =
    (exports as WebAssembly.Exports & { memory?: WebAssembly.Memory }).memory || env.memory;

  if (!currentMemory) {
    throw new Error('Vidking WASM runtime memory was not exposed');
  }

  return createVidkingWasmWrapper(exports, currentMemory);
}

function computeVerificationHash(serveCode: string): string {
  const ast = parse(serveCode, {
    ecmaVersion: 'latest',
    sourceType: 'script',
  }) as any;

  const preludeNodes = Array.isArray(ast?.body) ? ast.body.slice(0, -1) : [];
  if (!preludeNodes.length) {
    throw new Error('Vidking runtime prelude could not be parsed');
  }

  const sandbox: Record<string, any> = {
    console: {
      log() {},
      warn() {},
      error() {},
    },
    decodeURIComponent,
    encodeURIComponent,
    Array,
    Date,
    JSON,
    Math,
    Number,
    Object,
    String,
    parseInt,
  };

  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  const context = createContext(sandbox);
  const preludeSource = preludeNodes
    .map((node: { start: number; end: number }) => serveCode.slice(node.start, node.end))
    .join('\n');

  runInContext(preludeSource, context, {
    timeout: RUNTIME_BOOT_TIMEOUT_MS,
  });

  const rotated = typeof sandbox._0x3 === 'string' ? sandbox._0x3 : '';
  const suffix = typeof sandbox.X12 === 'string' ? sandbox.X12 : '';
  const seed = rotated.split('+')[0] + suffix;
  if (!seed) {
    throw new Error('Vidking runtime seed could not be derived');
  }

  return createHash('sha512').update(seed).digest('hex');
}

async function bootstrapVidkingRuntime(): Promise<VidkingRuntimeState> {
  const module = await instantiateVidkingRuntimeModule(`${SITE_ORIGIN}/assets/wasm/module1.wasm`);
  const serveCode = module.serve();
  if (!serveCode) {
    throw new Error('Vidking WASM runtime did not return bootstrap code');
  }

  const verificationHash = computeVerificationHash(serveCode);
  if (!module.verify(verificationHash)) {
    throw new Error('Vidking runtime rejected derived verification hash');
  }

  return {
    module,
    verificationHash,
  };
}

async function getRuntime(): Promise<VidkingRuntimeState> {
  if (!runtimePromise) {
    runtimePromise = bootstrapVidkingRuntime().catch(error => {
      runtimePromise = null;
      throw error;
    });
  }

  return runtimePromise;
}

async function fetchVidkingMetadata(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<VidkingMetadata | null> {
  const url = `${TMDB_ORIGIN}/${mediaType}/${encodeURIComponent(
    tmdbId
  )}?append_to_response=external_ids`;
  const payload = await fetchJson<any>(url);
  if (!payload) {
    return null;
  }

  const title = String(mediaType === 'movie' ? payload?.title : payload?.name || '').trim();
  const dateValue =
    mediaType === 'movie' ? payload?.release_date || '' : payload?.first_air_date || '';
  const year = Number.parseInt(String(dateValue).slice(0, 4), 10);
  const imdbId = String(payload?.external_ids?.imdb_id || '').trim();

  if (!title || !Number.isFinite(year)) {
    return null;
  }

  return {
    title,
    year,
    imdbId,
  };
}

function buildSourceApiUrl(
  server: (typeof SERVER_ENDPOINTS)[number],
  metadata: VidkingMetadata,
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
): string {
  const url = new URL(`${API_ORIGIN}/${server.endpoint}`);
  url.searchParams.append('title', metadata.title);
  url.searchParams.append('mediaType', mediaType);
  url.searchParams.append('year', String(metadata.year));
  url.searchParams.append('episodeId', String(episodeNum || 1));
  url.searchParams.append('seasonId', String(seasonNum || 1));
  url.searchParams.append('tmdbId', tmdbId);
  url.searchParams.append('imdbId', metadata.imdbId || '');
  url.searchParams.append('_t', String(Date.now()));
  return url.toString();
}

async function verifyPlayableManifest(url: string): Promise<boolean> {
  const response = await withTimeout(
    url,
    {
      headers: {
        Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*',
        Referer: REFERER,
        Origin: SITE_ORIGIN,
        'User-Agent': MODERN_UA,
      },
    },
    REQUEST_TIMEOUT_MS
  ).catch(() => null);

  if (!response?.ok) {
    return false;
  }

  const body = await response.text().catch(() => '');
  return body.trimStart().startsWith('#EXTM3U');
}

function pickSubtitleUrl(subtitles: VidkingSubtitleEntry[] | undefined): string {
  const candidates = Array.isArray(subtitles) ? subtitles : [];
  const preferred =
    candidates.find(item => /english/i.test(`${item.language || ''} ${item.lang || ''}`)) ||
    candidates[0];

  return normalizeHttpUrl(String(preferred?.url || preferred?.file || '').trim()) || '';
}

async function resolveStreamsFromPayload(payload: VidkingPayload): Promise<ResolvedStreamData[]> {
  const subtitle = pickSubtitleUrl(payload.subtitles);
  const dedupe = new Set<string>();
  const resolved: ResolvedStreamData[] = [];

  for (const source of payload.sources || []) {
    const masterPlaylistUrl = normalizeM3u8Url(String(source?.url || ''));
    if (!masterPlaylistUrl) {
      continue;
    }

    const quality = normalizeQuality(source?.quality);
    const dedupeKey = `${quality}:${masterPlaylistUrl}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    if (!(await verifyPlayableManifest(masterPlaylistUrl))) {
      continue;
    }

    dedupe.add(dedupeKey);
    resolved.push({
      masterPlaylistUrl,
      referer: REFERER,
      origin: SITE_ORIGIN,
      quality,
      subtitle,
    });
  }

  resolved.sort((left, right) => qualityScore(right.quality) - qualityScore(left.quality));
  return resolved;
}

async function decryptPayload(
  encryptedValue: string,
  tmdbId: string,
  runtime: VidkingRuntimeState
): Promise<VidkingPayload | null> {
  const numericTmdbId = Number.parseInt(tmdbId, 10);
  if (!Number.isFinite(numericTmdbId)) {
    return null;
  }

  if (!runtime.module.verify(runtime.verificationHash)) {
    return null;
  }

  const innerCiphertext = runtime.module.decrypt(encryptedValue.trim(), numericTmdbId);
  if (!innerCiphertext) {
    return null;
  }

  const plainText = decryptOpenSslBase64(innerCiphertext, '');
  const payload = JSON.parse(plainText) as VidkingPayload;
  return payload && Array.isArray(payload.sources) ? payload : null;
}

async function resolveVidkingStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  seasonNum?: number | null,
  episodeNum?: number | null
): Promise<ResolvedStreamData[]> {
  const [runtime, metadata] = await Promise.all([
    getRuntime(),
    fetchVidkingMetadata(tmdbId, mediaType),
  ]);
  if (!metadata) {
    return [];
  }

  for (const server of SERVER_ENDPOINTS) {
    try {
      const apiUrl = buildSourceApiUrl(server, metadata, mediaType, tmdbId, seasonNum, episodeNum);
      const encryptedValue = await fetchText(apiUrl);
      if (!encryptedValue || !looksLikeEncryptedHex(encryptedValue)) {
        continue;
      }

      const payload = await decryptPayload(encryptedValue, tmdbId, runtime);
      if (!payload?.sources?.length) {
        continue;
      }

      const streams = await resolveStreamsFromPayload(payload);
      if (streams.length) {
        return streams;
      }
    } catch {
      // Try the next server.
    }
  }

  return [];
}

export async function getVidkingStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv' = 'movie',
  seasonNum?: number | null,
  episodeNum?: number | null,
  storage?: StorageLike
): Promise<Stream[]> {
  try {
    if (mediaType === 'tv' && (seasonNum == null || episodeNum == null)) {
      return [];
    }

    const cacheKey = buildStreamCacheKey(mediaType, tmdbId, seasonNum, episodeNum);
    const cached = await getCached<ResolvedStreamData[]>(storage, cacheKey);
    const streamData =
      Array.isArray(cached) && cached.length
        ? cached
        : await resolveVidkingStreams(tmdbId, mediaType, seasonNum, episodeNum);

    if (!streamData.length) {
      return [];
    }

    if (!cached?.length) {
      await setCached(storage, cacheKey, streamData, STREAM_CACHE_TTL);
    }

    return streamData.map(stream => ({
      name: `Vidking - ${stream.quality}`,
      title: `Vidking - ${stream.quality}`,
      url: stream.masterPlaylistUrl,
      subtitle: stream.subtitle,
      quality: stream.quality,
      provider: 'vidking',
      streamType: 'hls',
      headers: {
        Referer: stream.referer,
        Origin: stream.origin,
        'User-Agent': MODERN_UA,
      },
    }));
  } catch (error: any) {
    console.error(`[Vidking] Error: ${error?.message || String(error)}`);
    return [];
  }
}
