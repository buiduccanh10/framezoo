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
  serverName: string;
  serverRank: number;
  variantId: string;
}

interface SeedResponse {
  seed?: string;
  ttlMs?: number;
}

interface SeedCacheEntry {
  seed: string;
  expiresAt: number;
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
const VERIFY_STREAMS = process.env.VIDKING_VERIFY_STREAMS === '1';
const SERVER_RESOLVE_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.VIDKING_SERVER_CONCURRENCY || '4', 10) || 4
);
const STREAM_CACHE_TTL = Number(process.env.VIDKING_CACHE_TTL || 5 * 60);
const CACHE_VERSION = 5;
const SEED_CACHE_VERSION = 1;
const SEED_CACHE_EARLY_EXPIRY_MS = 5_000;
const STALE_SEED_STORAGE_TTL_SECONDS = Math.max(
  60,
  Number.parseInt(process.env.VIDKING_STALE_SEED_STORAGE_TTL || '3600', 10) || 3600
);
const PAYLOAD_MAGIC_PREFIX = Uint8Array.from([109, 118, 109, 49]);
const ROUND_CONSTANTS = [
  1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221,
  3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580,
] as const;
const HASH_SEED = 1732584193;
const MIXED_STATE_SIZE = 61;
const MIXED_STATE_ROUNDS = 8;
const GOLDEN_RATIO_32 = 2654435769;

const SERVER_ENDPOINTS = [
  { name: 'Hydrogen', endpoint: 'cdn/sources-with-title' },
  { name: 'Titanium', endpoint: 'tejo/sources-with-title' },
  { name: 'Oxygen', endpoint: 'neon2/sources-with-title' },
  { name: 'Lithium', endpoint: 'downloader2/sources-with-title' },
  { name: 'Helium', endpoint: '1movies/sources-with-title' },
] as const;

const seedCache = new Map<string, SeedCacheEntry>();

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
    return 'auto';
  }

  const match = value.match(/(\d{3,4})/);
  return match ? `${match[1]}p` : value;
}

function slugifyVariantPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildVariantId(serverName: string, quality: string, masterPlaylistUrl: string): string {
  const serverSlug = slugifyVariantPart(serverName) || 'server';
  return `vidking-${serverSlug}-${quality.toLowerCase()}-${fnvHash(masterPlaylistUrl).toString(16)}`;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await mapper(items[index], index);
      }
    })
  );

  return results;
}

function qualityScore(quality: string): number {
  const match = quality.match(/(\d{3,4})/);
  return match ? Number.parseInt(match[1], 10) : 0;
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

function getSeedStorageKey(tmdbId: string): string {
  return `vidking:seed:v${SEED_CACHE_VERSION}:${tmdbId}`;
}

function getSeedStorage(): StorageLike | null {
  try {
    return useStorage('cache');
  } catch {
    return null;
  }
}

async function getStoredSeed(tmdbId: string): Promise<SeedCacheEntry | null> {
  const storage = getSeedStorage();
  if (!storage) {
    return null;
  }

  try {
    return (await storage.getItem<SeedCacheEntry>(getSeedStorageKey(tmdbId))) || null;
  } catch {
    return null;
  }
}

async function setStoredSeed(
  tmdbId: string,
  value: SeedCacheEntry,
  ttlMs: number
): Promise<void> {
  const storage = getSeedStorage();
  if (!storage) {
    return;
  }

  try {
    await storage.setItem(getSeedStorageKey(tmdbId), value as any, {
      ttl: Math.max(Math.ceil(ttlMs / 1000), STALE_SEED_STORAGE_TTL_SECONDS),
    });
  } catch {
    // Ignore cache failures.
  }
}

function clearSeedCache(tmdbId: string): void {
  seedCache.delete(getSeedCacheKey(tmdbId));

  const storage = getSeedStorage();
  if (!storage) {
    return;
  }

  void storage.removeItem(getSeedStorageKey(tmdbId)).catch(() => null);
}

async function getSeed(tmdbId: string, forceRefresh = false): Promise<string | null> {
  const cacheKey = getSeedCacheKey(tmdbId);
  const now = Date.now();
  const memoryCached = seedCache.get(cacheKey);
  const storedCached = !forceRefresh && !memoryCached ? await getStoredSeed(tmdbId) : null;
  const cached = memoryCached || storedCached;

  if (!forceRefresh && cached && cached.expiresAt - SEED_CACHE_EARLY_EXPIRY_MS > now) {
    if (!memoryCached) {
      seedCache.set(cacheKey, cached);
    }
    return cached.seed;
  }

  const payload = await fetchJson<SeedResponse>(
    `${API_ORIGIN}/seed?mediaId=${encodeURIComponent(tmdbId)}`
  );
  const seed = String(payload?.seed || '').trim();
  if (!seed) {
    return cached?.seed || null;
  }

  const ttlMs = Number.isFinite(payload?.ttlMs) ? Number(payload?.ttlMs) : 30_000;
  const entry = {
    seed,
    expiresAt: now + Math.max(ttlMs, 1_000),
  } satisfies SeedCacheEntry;
  seedCache.set(cacheKey, entry);
  await setStoredSeed(tmdbId, entry, ttlMs);

  return seed;
}

function buildSourceApiUrl(
  server: (typeof SERVER_ENDPOINTS)[number],
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

async function verifyPlayableManifest(url: string): Promise<boolean> {
  const response = await withTimeout(
    url,
    {
      headers: buildRequestHeaders(
        'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*'
      ),
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

async function resolveStreamsFromPayload(
  payload: VidkingPayload,
  serverName: string,
  serverRank: number
): Promise<ResolvedStreamData[]> {
  const subtitle = pickSubtitleUrl(payload.subtitles);
  const dedupe = new Set<string>();
  const resolved = await Promise.all(
    (payload.sources || []).map(async source => {
      const masterPlaylistUrl = normalizeM3u8Url(String(source?.url || ''));
      if (!masterPlaylistUrl) {
        return null;
      }

      if (VERIFY_STREAMS && !(await verifyPlayableManifest(masterPlaylistUrl))) {
        return null;
      }

      const quality = normalizeQuality(source?.quality);
      const dedupeKey = `${serverName}:${quality}:${masterPlaylistUrl}`;
      if (dedupe.has(dedupeKey)) {
        return null;
      }

      dedupe.add(dedupeKey);
      return {
        masterPlaylistUrl,
        referer: REFERER,
        origin: SITE_ORIGIN,
        quality,
        subtitle,
        serverName,
        serverRank,
        variantId: buildVariantId(serverName, quality, masterPlaylistUrl),
      } satisfies ResolvedStreamData;
    })
  );

  return resolved
    .filter((stream): stream is ResolvedStreamData => Boolean(stream))
    .sort(
      (left, right) =>
        left.serverRank - right.serverRank || qualityScore(right.quality) - qualityScore(left.quality)
    );
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
  const response = await withTimeout(
    url,
    {
      headers: buildRequestHeaders('text/plain,*/*'),
    },
    REQUEST_TIMEOUT_MS
  ).catch(() => null);

  if (!response) {
    return null;
  }

  const body = await response.text().catch(() => '');
  return {
    status: response.status,
    body,
  };
}

async function fetchServerPayload(
  server: (typeof SERVER_ENDPOINTS)[number],
  metadata: VidkingMetadata,
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  seasonNum?: number | null,
  episodeNum?: number | null
): Promise<VidkingPayload | null> {
  let seed = await getSeed(tmdbId);
  if (!seed) {
    return null;
  }

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

async function resolveVidkingStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  seasonNum?: number | null,
  episodeNum?: number | null
): Promise<ResolvedStreamData[]> {
  const metadata = await fetchVidkingMetadata(tmdbId, mediaType);
  if (!metadata) {
    return [];
  }

  const resolved = await mapWithConcurrency(
    SERVER_ENDPOINTS,
    SERVER_RESOLVE_CONCURRENCY,
    async (server, serverRank) => {
      try {
        const payload = await fetchServerPayload(
          server,
          metadata,
          tmdbId,
          mediaType,
          seasonNum,
          episodeNum
        );
        if (!payload?.sources?.length) {
          return [] as ResolvedStreamData[];
        }

        return await resolveStreamsFromPayload(payload, server.name, serverRank);
      } catch {
        return [] as ResolvedStreamData[];
      }
    }
  );

  return resolved.flat().sort(
    (left, right) =>
      left.serverRank - right.serverRank || qualityScore(right.quality) - qualityScore(left.quality)
  );
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
      name: `Vidking - ${stream.serverName} - ${stream.quality}`,
      title: `Vidking - ${stream.serverName} - ${stream.quality}`,
      url: stream.masterPlaylistUrl,
      subtitle: stream.subtitle,
      quality: stream.quality,
      provider: 'vidking',
      variantId: stream.variantId,
      variantLabel: stream.serverName,
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
