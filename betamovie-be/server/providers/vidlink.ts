/**
 * Vidlink streaming provider integration.
 * Uses vidlink's wasm runtime to derive secure token (getAdv) from TMDB id,
 * then resolves either legacy HLS playlists or the newer signed MP4 qualities
 * returned from /api/b/* endpoints.
 */

import type { Stream } from './types';

interface ResolvedStreamData {
  streamType: 'hls' | 'file';
  resourceUrl: string;
  referer: string;
  origin: string;
  quality: string;
  subtitle: string;
}

interface LegacyCachedStreamData {
  masterPlaylistUrl?: string;
  referer?: string;
  origin?: string;
}

interface VidlinkCaption {
  file?: string;
  url?: string;
  src?: string;
  label?: string;
  language?: string;
  lang?: string;
}

interface VidlinkQualitySource {
  type?: string;
  url?: string;
  src?: string;
}

interface VidlinkApiPayload {
  playlist?: string;
  captions?: VidlinkCaption[];
  stream?: {
    type?: string;
    url?: string;
    hls?: string;
    playlist?: string;
    captions?: VidlinkCaption[];
    qualities?: Record<string, VidlinkQualitySource>;
  };
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

function normalizeCaptionUrl(rawUrl: string): string | null {
  return normalizeHttpUrl(rawUrl);
}

function extractFirstMediaLine(playlist: string): string | null {
  for (const line of playlist.split(/\r?\n/).map(value => value.trim())) {
    if (!line || line.startsWith('#') || line.startsWith('<')) continue;
    return line;
  }
  return null;
}

function qualityScore(quality: string): number {
  const match = quality.match(/(\d{3,4})/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function toQualityLabel(rawQuality: string): string {
  const value = String(rawQuality || '').trim();
  if (!value) {
    return 'unknown';
  }

  const match = value.match(/(\d{3,4})/);
  if (match) {
    return `${match[1]}p`;
  }

  return value;
}

function getCaptionCandidates(payload: VidlinkApiPayload): VidlinkCaption[] {
  const streamCaptions = Array.isArray(payload?.stream?.captions) ? payload.stream.captions : [];
  const rootCaptions = Array.isArray(payload?.captions) ? payload.captions : [];
  return [...streamCaptions, ...rootCaptions];
}

function extractSubtitleUrl(payload: VidlinkApiPayload): string {
  const candidates = getCaptionCandidates(payload)
    .map(item => ({
      url: normalizeCaptionUrl(item.file || item.url || item.src || ''),
      label: `${item.label || ''} ${item.language || ''} ${item.lang || ''}`.toLowerCase(),
    }))
    .filter((item): item is { url: string; label: string } => Boolean(item.url));

  if (!candidates.length) {
    return '';
  }

  const preferred =
    candidates.find(item => /(english|\ben\b|\beng\b)/i.test(item.label)) || candidates[0];
  return preferred.url;
}

function resolvePlaylistStreamData(
  rawPlaylistUrl: string,
  subtitle: string
): ResolvedStreamData | null {
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
            // Keep fallback origin.
          }
        }
      } catch {
        // Keep default headers.
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
        // Keep original normalized URL.
      }
    }
  } catch {
    // Keep normalized URL/default headers.
  }

  return {
    streamType: 'hls',
    resourceUrl: resolvedUrl,
    referer,
    origin,
    quality: '1080p',
    subtitle,
  };
}

function extractHlsCandidates(payload: VidlinkApiPayload, subtitle: string): ResolvedStreamData[] {
  const candidates = [
    payload?.stream?.playlist,
    payload?.stream?.hls,
    payload?.playlist,
    payload?.stream?.type === 'hls' ? payload?.stream?.url : '',
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(url => resolvePlaylistStreamData(url, subtitle))
    .filter((item): item is ResolvedStreamData => Boolean(item));

  return candidates;
}

function extractFileCandidates(payload: VidlinkApiPayload, subtitle: string): ResolvedStreamData[] {
  const qualities = payload?.stream?.qualities;
  if (!qualities || typeof qualities !== 'object') {
    return [];
  }

  const candidates = Object.entries(qualities)
    .map(([quality, item]) => {
      const itemType = typeof item?.type === 'string' ? item.type.toLowerCase() : '';
      const resourceUrl = normalizeHttpUrl(item?.url || item?.src || '');
      if (!resourceUrl) {
        return null;
      }

      if (itemType && itemType !== 'mp4') {
        return null;
      }

      return {
        streamType: 'file',
        resourceUrl,
        referer: REFERER,
        origin: BASE_ORIGIN,
        quality: toQualityLabel(quality),
        subtitle,
      } satisfies ResolvedStreamData;
    })
    .filter((item): item is ResolvedStreamData => Boolean(item));

  candidates.sort((a, b) => qualityScore(b.quality) - qualityScore(a.quality));
  return candidates;
}

async function verifyPlayableHlsStream(streamData: ResolvedStreamData): Promise<boolean> {
  const requestHeaders = {
    Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*',
    Referer: streamData.referer,
    Origin: streamData.origin,
    'User-Agent': MODERN_UA,
  };

  const playlistResponse = await fetch(streamData.resourceUrl, {
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

  let segmentUrl = new URL(firstLine, streamData.resourceUrl).toString();
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

function normalizeCachedStreamData(
  cached: unknown
): ResolvedStreamData[] | null {
  if (Array.isArray(cached)) {
    const items = cached.filter((item): item is ResolvedStreamData => {
      return (
        item != null &&
        typeof item === 'object' &&
        (item as ResolvedStreamData).streamType !== undefined &&
        typeof (item as ResolvedStreamData).resourceUrl === 'string'
      );
    });

    return items.length ? items : null;
  }

  if (cached && typeof cached === 'object' && typeof (cached as LegacyCachedStreamData).masterPlaylistUrl === 'string') {
    const legacy = cached as LegacyCachedStreamData;
    return [
      {
        streamType: 'hls',
        resourceUrl: legacy.masterPlaylistUrl || '',
        referer: legacy.referer || REFERER,
        origin: legacy.origin || BASE_ORIGIN,
        quality: '1080p',
        subtitle: '',
      },
    ];
  }

  return null;
}

async function getCachedStreams(
  cacheKey: string,
  storage: StorageLike
): Promise<ResolvedStreamData[] | null> {
  try {
    return normalizeCachedStreamData(await storage.getItem(cacheKey));
  } catch {
    return null;
  }
}

async function setCachedStreams(
  cacheKey: string,
  value: ResolvedStreamData[],
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

async function validateCachedStreams(
  streams: ResolvedStreamData[]
): Promise<ResolvedStreamData[]> {
  const validated: ResolvedStreamData[] = [];

  for (const stream of streams) {
    if (stream.streamType === 'file') {
      validated.push(stream);
      continue;
    }

    if (await verifyPlayableHlsStream(stream)) {
      validated.push(stream);
    }
  }

  return validated;
}

async function extractStreamsFromPayload(
  payload: VidlinkApiPayload,
  contentId: string
): Promise<ResolvedStreamData[]> {
  const subtitle = extractSubtitleUrl(payload);

  const hlsCandidates = extractHlsCandidates(payload, subtitle);
  if (hlsCandidates.length) {
    const playableHls: ResolvedStreamData[] = [];
    for (const candidate of hlsCandidates) {
      if (await verifyPlayableHlsStream(candidate)) {
        playableHls.push(candidate);
      }
    }

    if (playableHls.length) {
      return playableHls;
    }

    console.warn(`[Vidlink] Rejected non-playable HLS stream for TMDB ${contentId}`);
  }

  const fileCandidates = extractFileCandidates(payload, subtitle);
  if (fileCandidates.length) {
    return fileCandidates;
  }

  console.warn(`[Vidlink] Missing playable stream payload for TMDB ${contentId}`);
  return [];
}

async function extractStreamsFromApi(
  contentType: 'movie' | 'tv',
  contentId: string,
  seasonNum?: number | null,
  episodeNum?: number | null,
  storage?: StorageLike
): Promise<ResolvedStreamData[]> {
  if (storage) {
    const cacheKey = buildStreamCacheKey(contentType, contentId, seasonNum, episodeNum);
    const cached = await getCachedStreams(cacheKey, storage);
    if (cached?.length) {
      const validatedCached = await validateCachedStreams(cached);
      if (validatedCached.length) {
        return validatedCached;
      }
      await removeCachedStream(cacheKey, storage);
    }
  }

  await bootVidlinkRuntime();
  const getAdv = getAdvFunction();
  const token = getAdv(contentId);

  if (!token) {
    console.warn(`[Vidlink] getAdv returned empty token for TMDB ${contentId}`);
    return [];
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
    return [];
  }

  const rawPayload = await response.text();
  if (!rawPayload) {
    console.warn(`[Vidlink] Empty payload from API for TMDB ${contentId}`);
    return [];
  }

  let parsedPayload: VidlinkApiPayload;
  try {
    parsedPayload = JSON.parse(rawPayload);
  } catch {
    console.warn(`[Vidlink] Invalid JSON payload for TMDB ${contentId}`);
    return [];
  }

  const result = await extractStreamsFromPayload(parsedPayload, contentId);
  if (!result.length) {
    return [];
  }

  if (storage) {
    const cacheKey = buildStreamCacheKey(contentType, contentId, seasonNum, episodeNum);
    await setCachedStreams(cacheKey, result, storage);
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
    const streams = await extractStreamsFromApi(
      mediaType,
      tmdbId,
      seasonNum,
      episodeNum,
      storage
    );
    if (!streams.length) {
      return [];
    }

    return streams.map(stream => ({
      name:
        stream.streamType === 'hls' ? 'Vidlink - Auto' : `Vidlink - ${stream.quality}`,
      title:
        stream.streamType === 'hls'
          ? 'Vidlink - HLS'
          : `Vidlink - ${stream.quality} MP4`,
      url: stream.resourceUrl,
      subtitle: stream.subtitle,
      quality: stream.quality,
      provider: 'vidlink',
      streamType: stream.streamType,
      headers: {
        Referer: stream.referer,
        'User-Agent': MODERN_UA,
        Origin: stream.origin,
      },
    }));
  } catch (error: any) {
    console.error(`[Vidlink] Error: ${error.message || String(error)}`);
    return [];
  }
}
