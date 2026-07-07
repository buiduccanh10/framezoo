import type { Stream } from './types';

type StorageLike = ReturnType<typeof useStorage>;

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
  serverName?: string;
}

interface SeedResponse {
  seed?: string;
  ttlMs?: number;
}

interface SeedCacheEntry {
  seed: string;
  expiresAt: number;
}

interface ServerEndpoint {
  name: string;
  endpoint: string;
}

interface PlaylistVariantCandidate {
  playlistUrl: string;
  quality: string;
}

const SITE_BASE_URL = process.env.VIDKING_BASE_URL || 'https://www.vidking.net';
const SITE_ORIGIN = new URL(SITE_BASE_URL).origin;
const REFERER = `${SITE_ORIGIN}/`;
const API_ORIGIN = 'https://api.wingsdatabase.com';
const TMDB_ORIGIN = 'https://db.wingsdatabase.com/3';
const MODERN_UA =
  process.env.VIDKING_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = Number(process.env.VIDKING_REQUEST_TIMEOUT_MS || 18_000);
const VERIFY_TIMEOUT_MS = Math.max(
  1_500,
  Number.parseInt(process.env.VIDKING_VERIFY_TIMEOUT_MS || '5000', 10) || 5_000
);
const STREAM_CACHE_TTL = Number(process.env.VIDKING_CACHE_TTL || 5 * 60);
const CACHE_VERSION = 7;
const SEGMENT_PROBE_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.VIDKING_SEGMENT_PROBE_LIMIT || '3', 10) || 3
);
const MAX_VARIANTS_PER_PLAYLIST = Math.max(
  1,
  Number.parseInt(process.env.VIDKING_MAX_VARIANTS_PER_PLAYLIST || '8', 10) || 8
);
const MAX_SOURCE_ENTRIES_PER_SERVER = Math.max(
  1,
  Number.parseInt(process.env.VIDKING_MAX_SOURCE_ENTRIES_PER_SERVER || '8', 10) || 8
);
const MAX_STREAMS_PER_REQUEST = Math.max(
  1,
  Number.parseInt(process.env.VIDKING_MAX_STREAMS_PER_REQUEST || '12', 10) || 12
);
const MAX_SCRAPE_PASSES = Math.max(
  1,
  Number.parseInt(process.env.VIDKING_MAX_SCRAPE_PASSES || '3', 10) || 3
);
const UPSTREAM_RETRY_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.VIDKING_UPSTREAM_RETRY_ATTEMPTS || '3', 10) || 3
);
const SEED_CACHE_EARLY_EXPIRY_MS = 5_000;
const PAYLOAD_MAGIC_PREFIX = Uint8Array.from([109, 118, 109, 49]);
const ROUND_CONSTANTS = [
  1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221,
  3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580,
] as const;
const HASH_SEED = 1732584193;
const MIXED_STATE_SIZE = 61;
const MIXED_STATE_ROUNDS = 8;
const GOLDEN_RATIO_32 = 2654435769;

const DEFAULT_SERVER_ENDPOINTS = [
  { name: 'Hydrogen', endpoint: 'cdn/sources-with-title' },
  { name: 'Titanium', endpoint: 'tejo/sources-with-title' },
  { name: 'Oxygen', endpoint: 'neon2/sources-with-title' },
  { name: 'Lithium', endpoint: 'downloader2/sources-with-title' },
  { name: 'Helium', endpoint: '1movies/sources-with-title' },
] as const satisfies readonly ServerEndpoint[];

const seedCache = new Map<string, SeedCacheEntry>();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

function buildRequestHeaders(accept: string, extraHeaders: HeadersInit = {}): HeadersInit {
  return {
    Accept: accept,
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    Referer: REFERER,
    Origin: SITE_ORIGIN,
    'User-Agent': MODERN_UA,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    ...extraHeaders,
  };
}

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

async function fetchJson<T>(url: string, headers: HeadersInit = {}): Promise<T | null> {
  const response = await withTimeout(
    url,
    {
      headers: buildRequestHeaders('application/json,text/plain,*/*', headers),
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
    return 'Auto';
  }

  if (/^(auto|adaptive)$/i.test(value)) {
    return 'Auto';
  }

  if (/(?:^|\b)(4k|uhd|2160)(?:\b|p)/i.test(value)) {
    return '4K';
  }

  const match = value.match(/(\d{3,4})/);
  return match ? `${match[1]}p` : value;
}

function qualityScore(quality: string): number {
  if (/(?:^|\b)4k(?:\b|$)|2160/i.test(quality)) {
    return 2160;
  }

  const match = quality.match(/(\d{3,4})/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function sortResolvedStreams(streams: ResolvedStreamData[]): ResolvedStreamData[] {
  return [...streams].sort((left, right) => {
    if (left.quality === 'Auto' && right.quality !== 'Auto') {
      return 1;
    }

    if (right.quality === 'Auto' && left.quality !== 'Auto') {
      return -1;
    }

    const qualityDelta = qualityScore(right.quality) - qualityScore(left.quality);
    if (qualityDelta !== 0) {
      return qualityDelta;
    }

    return (left.serverName || '').localeCompare(right.serverName || '');
  });
}

function mergeResolvedStreams(...groups: ResolvedStreamData[][]): ResolvedStreamData[] {
  const dedupe = new Set<string>();
  const merged: ResolvedStreamData[] = [];

  for (const group of groups) {
    for (const stream of group) {
      const dedupeKey = `${stream.quality}:${stream.masterPlaylistUrl}`;
      if (dedupe.has(dedupeKey)) {
        continue;
      }

      dedupe.add(dedupeKey);
      merged.push(stream);
    }
  }

  return sortResolvedStreams(merged).slice(0, MAX_STREAMS_PER_REQUEST);
}

function shouldEnrichResolvedStreams(streams: ResolvedStreamData[]): boolean {
  const qualities = new Set(streams.map(stream => stream.quality));
  const nonAutoCount = streams.filter(stream => stream.quality !== 'Auto').length;
  const has4k = qualities.has('4K');
  const has1080 = qualities.has('1080p');
  const has720 = qualities.has('720p');

  if (!nonAutoCount) {
    return true;
  }

  if (has4k && !has1080) {
    return true;
  }

  if ((has4k || has1080) && !has720) {
    return true;
  }

  if (has720 && !has4k && !has1080) {
    return true;
  }

  return nonAutoCount < 4;
}

function normalizeServerEndpointPath(rawEndpoint: string): string | null {
  const value = String(rawEndpoint || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (!value) {
    return null;
  }

  return value.includes('/') ? value : `${value}/sources-with-title`;
}

function parseServerEndpointEntry(rawEntry: unknown, index: number): ServerEndpoint | null {
  if (typeof rawEntry === 'object' && rawEntry != null) {
    const endpoint = normalizeServerEndpointPath((rawEntry as any).endpoint);
    const name = String((rawEntry as any).name || `Server ${index + 1}`).trim();
    return endpoint ? { name, endpoint } : null;
  }

  const value = String(rawEntry || '').trim();
  if (!value) {
    return null;
  }

  const namedMatch = value.match(/^([^:=|]+)\s*[:=|]\s*(.+)$/);
  const rawName = namedMatch?.[1]?.trim() || `Server ${index + 1}`;
  const rawEndpoint = namedMatch?.[2]?.trim() || value;
  const endpoint = normalizeServerEndpointPath(rawEndpoint);
  return endpoint ? { name: rawName, endpoint } : null;
}

function getServerEndpoints(): ServerEndpoint[] {
  const rawConfig = String(process.env.VIDKING_SERVER_ENDPOINTS || '').trim();
  let configured: ServerEndpoint[] = [];

  if (rawConfig) {
    if (rawConfig.startsWith('[')) {
      try {
        const parsed = JSON.parse(rawConfig);
        if (Array.isArray(parsed)) {
          configured = parsed
            .map((entry, index) => parseServerEndpointEntry(entry, index))
            .filter((entry): entry is ServerEndpoint => Boolean(entry));
        }
      } catch {
        configured = [];
      }
    } else {
      configured = rawConfig
        .split(',')
        .map((entry, index) => parseServerEndpointEntry(entry, index))
        .filter((entry): entry is ServerEndpoint => Boolean(entry));
    }
  }

  const dedupe = new Set<string>();
  return [...configured, ...DEFAULT_SERVER_ENDPOINTS].filter(server => {
    const dedupeKey = server.endpoint.toLowerCase();
    if (dedupe.has(dedupeKey)) {
      return false;
    }

    dedupe.add(dedupeKey);
    return true;
  });
}

function extractPlaylistLines(playlist: string): string[] {
  return playlist
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function inferQualityFromUrl(url: string): string {
  const match = url.match(/(?:^|\/)(2160|1440|1080|720|540|480|360|270)p?(?:\/|$)/i);
  if (!match?.[1]) {
    return '';
  }

  return match[1] === '2160' ? '4K' : `${match[1]}p`;
}

function inferQualityFromStreamInf(
  attributes: string,
  playlistUrl: string,
  fallbackQuality: string
): string {
  const resolutionMatch = attributes.match(/RESOLUTION=\d+x(\d{3,4})/i);
  if (resolutionMatch?.[1]) {
    return resolutionMatch[1] === '2160' ? '4K' : `${resolutionMatch[1]}p`;
  }

  const inferredFromUrl = inferQualityFromUrl(playlistUrl);
  if (inferredFromUrl) {
    return inferredFromUrl;
  }

  return fallbackQuality || 'Auto';
}

function extractVariantCandidates(
  manifest: string,
  playlistUrl: string,
  fallbackQuality: string
): PlaylistVariantCandidate[] {
  const variants: PlaylistVariantCandidate[] = [];
  let currentStreamInf = '';

  for (const line of extractPlaylistLines(manifest)) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      currentStreamInf = line.slice('#EXT-X-STREAM-INF:'.length);
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    if (!currentStreamInf && !/\.m3u8(?:$|[?#])/i.test(line)) {
      continue;
    }

    const normalized = normalizeM3u8Url(new URL(line, playlistUrl).toString());
    if (!normalized) {
      currentStreamInf = '';
      continue;
    }

    variants.push({
      playlistUrl: normalized,
      quality: inferQualityFromStreamInf(currentStreamInf, normalized, fallbackQuality),
    });
    currentStreamInf = '';
  }

  return variants;
}

function extractSegmentCandidates(playlist: string, playlistUrl: string): string[] {
  const candidates: string[] = [];

  for (const line of extractPlaylistLines(playlist)) {
    if (line.startsWith('#')) {
      continue;
    }

    const absolute = normalizeHttpUrl(new URL(line, playlistUrl).toString());
    if (!absolute) {
      continue;
    }

    candidates.push(absolute);
    if (candidates.length >= SEGMENT_PROBE_LIMIT) {
      break;
    }
  }

  return candidates;
}

function hasSegmentCandidates(playlist: string, playlistUrl: string): boolean {
  return extractSegmentCandidates(playlist, playlistUrl).some(
    candidate => !/\.m3u8(?:$|[?#])/i.test(candidate)
  );
}

function isLikelyHtmlPayload(bytes: Uint8Array): boolean {
  const preview = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, 128))
    .toLowerCase();
  return preview.includes('<!doctype') || preview.includes('<html') || preview.includes('<body');
}

function isLikelyTransportStream(bytes: Uint8Array): boolean {
  if (bytes.length >= 188 * 3) {
    return bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47;
  }

  return bytes.length >= 188 && bytes[0] === 0x47;
}

function isLikelyMp4Segment(bytes: Uint8Array): boolean {
  if (bytes.length < 12) {
    return false;
  }

  const boxType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  return boxType === 'ftyp' || boxType === 'styp' || boxType === 'moof';
}

function isLikelyPlayableSegmentPayload(bytes: Uint8Array): boolean {
  if (!bytes.length) {
    return false;
  }

  if (isLikelyTransportStream(bytes) || isLikelyMp4Segment(bytes)) {
    return true;
  }

  if (isLikelyHtmlPayload(bytes)) {
    return false;
  }

  return bytes.length >= 1_024;
}

async function fetchPlaylistText(
  url: string,
  referer: string,
  origin: string
): Promise<string | null> {
  const response = await withTimeout(
    url,
    {
      headers: buildRequestHeaders(
        'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*',
        {
          Referer: referer,
          Origin: origin,
        }
      ),
    },
    VERIFY_TIMEOUT_MS
  ).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const body = await response.text().catch(() => '');
  return body.trimStart().startsWith('#EXTM3U') ? body : null;
}

async function resolveSegmentProbeUrl(
  playlistUrl: string,
  referer: string,
  origin: string,
  depth = 0
): Promise<string | null> {
  if (depth > 3) {
    return null;
  }

  const playlist = await fetchPlaylistText(playlistUrl, referer, origin);
  if (!playlist) {
    return null;
  }

  for (const candidate of extractSegmentCandidates(playlist, playlistUrl)) {
    if (/\.m3u8(?:$|[?#])/i.test(candidate)) {
      const nested = await resolveSegmentProbeUrl(candidate, referer, origin, depth + 1);
      if (nested) {
        return nested;
      }
      continue;
    }

    return candidate;
  }

  return null;
}

async function fetchSegmentProbe(url: string, referer: string, origin: string): Promise<boolean> {
  const response = await withTimeout(
    url,
    {
      headers: buildRequestHeaders('*/*', {
        Referer: referer,
        Origin: origin,
        Range: 'bytes=0-65535',
      }),
    },
    VERIFY_TIMEOUT_MS
  ).catch(() => null);

  if (!response?.ok) {
    return false;
  }

  const bytes = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
  return isLikelyPlayableSegmentPayload(bytes);
}

async function verifyPlayablePlaylist(
  url: string,
  referer: string,
  origin: string
): Promise<boolean> {
  const segmentUrl = await resolveSegmentProbeUrl(url, referer, origin);
  return segmentUrl ? await fetchSegmentProbe(segmentUrl, referer, origin) : false;
}

function rotateLeft32(value: number, bits: number): number {
  value >>>= 0;
  bits &= 31;
  return bits === 0 ? value >>> 0 : ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function mix32(value: number): number {
  value >>>= 0;
  value ^= value >>> 16;
  value = Math.imul(value, 2246822507) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 3266489909) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

function hasEvenTriangularParity(value: number): boolean {
  return ((value * (value + 1)) & 1) === 0;
}

function hasOddTriangularParity(value: number): boolean {
  return ((value * (value + 1)) & 1) === 1;
}

function seedStringHash(value: string): number {
  let hash = HASH_SEED >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = rotateLeft32(
      (hash ^ Math.imul(value.charCodeAt(index), ROUND_CONSTANTS[index & 15])) >>> 0,
      5
    );
  }
  return mix32(hash);
}

function buildPermutationState(seed: string): number[] {
  const state = Array.from({ length: 256 }, (_value, index) => index);
  let cursor = 0;

  for (let index = 0; index < state.length; index += 1) {
    cursor = (cursor + state[index] + seed.charCodeAt(index % seed.length)) & 255;
    const current = state[index];
    state[index] = state[cursor];
    state[cursor] = current;
  }

  return state;
}

function fnvHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  }
  return mix32(hash);
}

function blendAccumulator(left: number, right: number, mask: number): number {
  return (((left ^ right) >>> 0) | ((left & right & mask) >>> 0)) >>> 0;
}

type KeystreamState = { S: number[]; acc: number };

function createKeystreamState(seed: string, mediaId: number): KeystreamState {
  if (hasOddTriangularParity(seed.length)) {
    return {
      S: buildPermutationState(seed),
      acc: seedStringHash(seed),
    };
  }

  const mixed = new Array<number>(MIXED_STATE_SIZE);
  let acc = mix32(fnvHash(seed) ^ mix32((mediaId >>> 0) ^ GOLDEN_RATIO_32)) >>> 0;

  for (let round = 0; round < MIXED_STATE_ROUNDS; round += 1) {
    if (hasEvenTriangularParity(round)) {
      const slot = acc % MIXED_STATE_SIZE;
      acc = rotateLeft32((acc + GOLDEN_RATIO_32) >>> 0, 7 + (round & 7));
      mixed[slot] = (acc ^ mix32(acc)) >>> 0;
      acc = mix32((acc + slot) >>> 0);
    } else {
      mixed[round] = ROUND_CONSTANTS[round & 15];
    }
  }

  return {
    S: mixed,
    acc: mix32(acc ^ 2779096485) >>> 0,
  };
}

function nextKeystreamWord(state: KeystreamState, counter: number): number {
  const values = state.S;
  let acc = state.acc;
  const slot = acc % MIXED_STATE_SIZE;
  const slotDefinedMask = 0 - +(slot in values);
  const slotValue = values[slot] >>> 0;
  const counterMix = Math.imul(GOLDEN_RATIO_32, counter + 1) >>> 0;

  let next = blendAccumulator(acc, (slotValue ^ counterMix) >>> 0, slotDefinedMask);
  next =
    (rotateLeft32((next + acc) >>> 0, slot & 31) ^ rotateLeft32(acc, Math.imul(slot, 7) & 31)) >>>
    0;
  acc = mix32((next + GOLDEN_RATIO_32) >>> 0);
  values[slot] = acc >>> 0;
  state.acc = acc;
  return acc >>> 0;
}

function generateKeystream(seed: string, mediaId: number, length: number): Uint8Array {
  const state = createKeystreamState(seed, mediaId);
  const bytes = new Uint8Array(length);
  let offset = 0;
  let counter = 0;

  while (offset < length) {
    const word = nextKeystreamWord(state, counter++);
    bytes[offset++] = word & 255;
    if (offset < length) bytes[offset++] = (word >>> 8) & 255;
    if (offset < length) bytes[offset++] = (word >>> 16) & 255;
    if (offset < length) bytes[offset++] = (word >>> 24) & 255;
  }

  return bytes;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');

  return new Uint8Array(Buffer.from(normalized, 'base64'));
}

function decryptSeededPayload(ciphertext: string, seed: string, mediaId: number): string {
  const encrypted = decodeBase64Url(ciphertext);
  const keystream = generateKeystream(seed, mediaId, encrypted.length);

  for (let index = 0; index < encrypted.length; index += 1) {
    encrypted[index] ^= keystream[index];
  }

  for (let index = 0; index < PAYLOAD_MAGIC_PREFIX.length; index += 1) {
    if (encrypted[index] !== PAYLOAD_MAGIC_PREFIX[index]) {
      throw new Error('Vidking payload verification failed');
    }
  }

  return new TextDecoder('utf-8').decode(encrypted.subarray(PAYLOAD_MAGIC_PREFIX.length));
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
  const imdbId = String(payload?.external_ids?.imdb_id || payload?.imdb_id || '').trim();

  if (!title || !Number.isFinite(year)) {
    return null;
  }

  return {
    title,
    year,
    imdbId,
  };
}

function getSeedCacheKey(tmdbId: string): string {
  return `${API_ORIGIN}|${tmdbId}`;
}

function clearSeedCache(tmdbId: string): void {
  seedCache.delete(getSeedCacheKey(tmdbId));
}

async function getSeed(tmdbId: string, forceRefresh = false): Promise<string | null> {
  const cacheKey = getSeedCacheKey(tmdbId);
  const now = Date.now();
  const cached = seedCache.get(cacheKey);

  if (!forceRefresh && cached && cached.expiresAt - SEED_CACHE_EARLY_EXPIRY_MS > now) {
    return cached.seed;
  }

  for (let attempt = 0; attempt < UPSTREAM_RETRY_ATTEMPTS; attempt += 1) {
    const response = await withTimeout(
      `${API_ORIGIN}/seed?mediaId=${encodeURIComponent(tmdbId)}`,
      {
        headers: buildRequestHeaders('application/json,text/plain,*/*'),
      },
      REQUEST_TIMEOUT_MS
    ).catch(() => null);

    if (!response) {
      if (attempt + 1 < UPSTREAM_RETRY_ATTEMPTS) {
        await sleep(150 * (attempt + 1));
        continue;
      }
      return null;
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt + 1 < UPSTREAM_RETRY_ATTEMPTS) {
        await sleep(150 * (attempt + 1));
        continue;
      }
      return null;
    }

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as SeedResponse | null;
    const seed = String(payload?.seed || '').trim();
    if (!seed) {
      if (attempt + 1 < UPSTREAM_RETRY_ATTEMPTS) {
        await sleep(150 * (attempt + 1));
        continue;
      }
      return null;
    }

    const ttlMs = Number.isFinite(payload?.ttlMs) ? Number(payload?.ttlMs) : 30_000;
    seedCache.set(cacheKey, {
      seed,
      expiresAt: Date.now() + Math.max(ttlMs, 1_000),
    });

    return seed;
  }

  return null;
}

function buildSourceApiUrl(
  server: ServerEndpoint,
  metadata: VidkingMetadata,
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  seed: string,
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
  url.searchParams.append('enc', '2');
  url.searchParams.append('seed', seed);
  url.searchParams.append('_t', String(Date.now()));
  return url.toString();
}

function pickSubtitleUrl(subtitles: VidkingSubtitleEntry[] | undefined): string {
  const candidates = Array.isArray(subtitles) ? subtitles : [];
  const preferred =
    candidates.find(item => /english/i.test(`${item.language || ''} ${item.lang || ''}`)) ||
    candidates[0];

  return normalizeHttpUrl(String(preferred?.url || preferred?.file || '').trim()) || '';
}

async function resolveStreamsFromPayloadWithServer(
  payload: VidkingPayload,
  serverName?: string
): Promise<ResolvedStreamData[]> {
  const subtitle = pickSubtitleUrl(payload.subtitles);
  const sourceResults = await Promise.allSettled(
    (payload.sources || []).slice(0, MAX_SOURCE_ENTRIES_PER_SERVER).map(async source => {
      const sourcePlaylistUrl = normalizeM3u8Url(String(source?.url || ''));
      if (!sourcePlaylistUrl) {
        return [];
      }

      const sourceQuality = normalizeQuality(source?.quality);
      const sourcePlaylist = await fetchPlaylistText(sourcePlaylistUrl, REFERER, SITE_ORIGIN);
      if (!sourcePlaylist) {
        return [];
      }

      const variants = extractVariantCandidates(sourcePlaylist, sourcePlaylistUrl, sourceQuality)
        .slice(0, MAX_VARIANTS_PER_PLAYLIST)
        .reduce<PlaylistVariantCandidate[]>((acc, variant) => {
          const normalizedQuality = normalizeQuality(variant.quality);
          const dedupeKey = `${normalizedQuality}:${variant.playlistUrl}`;
          if (acc.some(entry => `${normalizeQuality(entry.quality)}:${entry.playlistUrl}` === dedupeKey)) {
            return acc;
          }

          acc.push({
            playlistUrl: variant.playlistUrl,
            quality: normalizedQuality,
          });
          return acc;
        }, []);

      if (!variants.length) {
        if (!hasSegmentCandidates(sourcePlaylist, sourcePlaylistUrl)) {
          return [];
        }

        return [
          {
            masterPlaylistUrl: sourcePlaylistUrl,
            referer: REFERER,
            origin: SITE_ORIGIN,
            quality: sourceQuality,
            subtitle,
            serverName,
          } satisfies ResolvedStreamData,
        ];
      }

      // Keep every advertised variant from a valid master manifest. Per-variant segment probes
      // were dropping slow high-bitrate qualities like 1080p/4K before playback could start.
      const resolvedVariants = variants.map(
        variant =>
          ({
            masterPlaylistUrl: variant.playlistUrl,
            referer: REFERER,
            origin: SITE_ORIGIN,
            quality: variant.quality,
            subtitle,
            serverName,
          }) satisfies ResolvedStreamData
      );

      if (!resolvedVariants.length && !hasSegmentCandidates(sourcePlaylist, sourcePlaylistUrl)) {
        return [];
      }

      return [
        ...resolvedVariants,
        {
          masterPlaylistUrl: sourcePlaylistUrl,
          referer: REFERER,
          origin: SITE_ORIGIN,
          quality: 'Auto',
          subtitle,
          serverName,
        } satisfies ResolvedStreamData,
      ];
    })
  );

  const dedupe = new Set<string>();
  const resolved: ResolvedStreamData[] = [];

  for (const result of sourceResults) {
    if (result.status !== 'fulfilled') {
      continue;
    }

    for (const stream of result.value) {
      const dedupeKey =
        stream.quality === 'Auto' ? 'Auto' : `${stream.quality}:${stream.serverName || 'default'}`;
      if (dedupe.has(dedupeKey)) {
        continue;
      }

      dedupe.add(dedupeKey);
      resolved.push(stream);
    }
  }

  return sortResolvedStreams(resolved).slice(0, MAX_STREAMS_PER_REQUEST);
}

function decryptPayload(
  encryptedValue: string,
  tmdbId: string,
  seed: string
): VidkingPayload | null {
  const numericTmdbId = Number.parseInt(tmdbId, 10);
  if (!Number.isFinite(numericTmdbId)) {
    return null;
  }

  const plainText = decryptSeededPayload(encryptedValue.trim(), seed, numericTmdbId);
  const payload = JSON.parse(plainText) as VidkingPayload;
  return payload && Array.isArray(payload.sources) ? payload : null;
}

async function fetchEncryptedPayload(
  url: string
): Promise<{ status: number; body: string } | null> {
  for (let attempt = 0; attempt < UPSTREAM_RETRY_ATTEMPTS; attempt += 1) {
    const response = await withTimeout(
      url,
      {
        headers: buildRequestHeaders('text/plain,*/*'),
      },
      REQUEST_TIMEOUT_MS
    ).catch(() => null);

    if (!response) {
      if (attempt + 1 < UPSTREAM_RETRY_ATTEMPTS) {
        await sleep(150 * (attempt + 1));
        continue;
      }
      return null;
    }

    if (
      (response.status === 429 || response.status >= 500) &&
      attempt + 1 < UPSTREAM_RETRY_ATTEMPTS
    ) {
      await sleep(150 * (attempt + 1));
      continue;
    }

    const body = await response.text().catch(() => '');
    return {
      status: response.status,
      body,
    };
  }

  return null;
}

async function fetchServerPayload(
  server: ServerEndpoint,
  metadata: VidkingMetadata,
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  initialSeed: string,
  seasonNum?: number | null,
  episodeNum?: number | null
): Promise<VidkingPayload | null> {
  let seed = initialSeed;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const apiUrl = buildSourceApiUrl(
      server,
      metadata,
      mediaType,
      tmdbId,
      seed,
      seasonNum,
      episodeNum
    );
    const response = await fetchEncryptedPayload(apiUrl);
    if (!response) {
      return null;
    }

    if (response.status === 401 && attempt === 0) {
      clearSeedCache(tmdbId);
      seed = await getSeed(tmdbId, true);
      if (!seed) {
        return null;
      }
      continue;
    }

    if (response.status < 200 || response.status >= 300 || !response.body.trim()) {
      return null;
    }

    try {
      return decryptPayload(response.body, tmdbId, seed);
    } catch {
      return null;
    }
  }

  return null;
}

async function resolveVidkingStreamsPass(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  forceFreshSeed = false,
  seasonNum?: number | null,
  episodeNum?: number | null
): Promise<ResolvedStreamData[]> {
  const metadata = await fetchVidkingMetadata(tmdbId, mediaType);
  if (!metadata) {
    return [];
  }

  const initialSeed = await getSeed(tmdbId, forceFreshSeed);
  if (!initialSeed) {
    return [];
  }

  const results = await Promise.allSettled(
    getServerEndpoints().map(async server => {
      const payload = await fetchServerPayload(
        server,
        metadata,
        tmdbId,
        mediaType,
        initialSeed,
        seasonNum,
        episodeNum
      );
      if (!payload?.sources?.length) {
        return [];
      }

      return await resolveStreamsFromPayloadWithServer(payload, server.name);
    })
  );

  const dedupe = new Set<string>();
  const streams: ResolvedStreamData[] = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') {
      continue;
    }

    streams.push(...result.value);
  }

  return mergeResolvedStreams(streams);
}

async function resolveVidkingStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  seasonNum?: number | null,
  episodeNum?: number | null
): Promise<ResolvedStreamData[]> {
  let merged: ResolvedStreamData[] = [];

  for (let attempt = 0; attempt < MAX_SCRAPE_PASSES; attempt += 1) {
    const passStreams = await resolveVidkingStreamsPass(
      tmdbId,
      mediaType,
      attempt > 0,
      seasonNum,
      episodeNum
    );
    merged = mergeResolvedStreams(merged, passStreams);

    if (!shouldEnrichResolvedStreams(merged)) {
      break;
    }
  }

  return merged;
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

    const qualityCounts = streamData.reduce<Record<string, number>>((acc, stream) => {
      acc[stream.quality] = (acc[stream.quality] || 0) + 1;
      return acc;
    }, {});

    return streamData.map(stream => ({
      name: `Vidking - ${stream.quality}${
        qualityCounts[stream.quality] > 1 && stream.serverName ? ` (${stream.serverName})` : ''
      }`,
      title: `Vidking - ${stream.quality}${
        qualityCounts[stream.quality] > 1 && stream.serverName ? ` (${stream.serverName})` : ''
      }`,
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
