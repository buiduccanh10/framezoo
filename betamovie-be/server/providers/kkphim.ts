/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import type { Stream, StreamLookupContext } from './types';

interface KKPhimTmdbRef {
  type?: 'movie' | 'tv' | null;
  id?: string | number | null;
  season?: number | null;
}

interface KKPhimSearchItem {
  name: string;
  origin_name: string;
  slug: string;
  year?: number;
  tmdb?: KKPhimTmdbRef;
}

interface KKPhimSearchResponse {
  data?: {
    items?: KKPhimSearchItem[];
    params?: {
      pagination?: {
        currentPage?: number;
        totalPages?: number;
      };
    };
  };
}

interface KKPhimEpisodeData {
  name: string;
  slug: string;
  link_embed?: string;
  link_m3u8?: string;
}

interface KKPhimServerData {
  server_name: string;
  server_data: KKPhimEpisodeData[];
}

interface KKPhimMovieMetadata {
  name: string;
  origin_name: string;
  country:
    | string
    | Array<{
        name?: string;
        slug?: string;
      }>;
  type: string;
  slug?: string;
  year?: number;
  tmdb?: KKPhimTmdbRef;
}

interface KKPhimDetailResponse {
  status: boolean;
  movie?: KKPhimMovieMetadata;
  episodes?: KKPhimServerData[];
}

type StorageLike = ReturnType<typeof useStorage>;

const KKPHIM_API_BASE = process.env.KKPHIM_API_BASE || 'https://phimapi.com';
const REFERER = `${new URL(KKPHIM_API_BASE).origin}/`;
const ORIGIN = new URL(KKPHIM_API_BASE).origin;
const MODERN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = Number(process.env.KKPHIM_REQUEST_TIMEOUT_MS ?? 10_000);
const SLUG_CACHE_TTL = Number(process.env.KKPHIM_SLUG_CACHE_TTL ?? 24 * 60 * 60);
const NEGATIVE_CACHE_TTL = Number(process.env.KKPHIM_NEGATIVE_CACHE_TTL ?? 5 * 60);
const SEED_CACHE_TTL = Number(process.env.KKPHIM_SEED_CACHE_TTL ?? 60 * 60);
const SEARCH_PAGE_LIMIT = Number(process.env.KKPHIM_SEARCH_PAGE_LIMIT ?? 20);
const SEARCH_MAX_PAGES = Number(process.env.KKPHIM_SEARCH_MAX_PAGES ?? 2);
const SLUG_CACHE_KEY_VERSION = 'v2';
const NEGATIVE_CACHE_KEY_VERSION = 'v4';
const SEED_CACHE_KEY_VERSION = 'v1';

const normalizeText = (value: string): string =>
  decodeHtmlEntities(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const normalizeKeyword = (value?: string): string =>
  decodeHtmlEntities(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeSlug = (value?: string): string =>
  decodeHtmlEntities(value ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/-+/g, '-');

const stripSeasonText = (value?: string): string =>
  normalizeKeyword(value)
    .replace(/\s*\((?:phần|phan|season)\s*\d+\)\s*/giu, ' ')
    .replace(/\b(?:phần|phan|season)\s*\d+\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const stripSeasonSlug = (value?: string): string =>
  normalizeSlug(value)
    .replace(/-(?:phan|season)-\d+\b/gi, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const parseSeasonFromText = (value?: string): number | null => {
  if (!value) return null;
  const match = normalizeText(value).match(/(?:phan|season)\s*(\d{1,2})/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&(apos|#39);/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

const uniqueValues = (values: Array<string | undefined | null>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
};

const fetchJson = async <T>(
  url: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<T | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': MODERN_UA,
      },
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const pickEpisode = (
  episodes: KKPhimEpisodeData[],
  mediaType: 'movie' | 'tv',
  episodeNumber?: number | null
): KKPhimEpisodeData | null => {
  if (!episodes.length) return null;

  if (mediaType === 'movie') {
    return episodes[0] ?? null;
  }

  if (!episodeNumber) {
    return null;
  }

  const target = String(episodeNumber);
  const targetPadded = target.padStart(2, '0');

  const matched = episodes.find(ep => {
    const normalizedName = normalizeText(ep.name || '')
      .replace(/^(tap|episode|ep)\s*/i, '')
      .trim();
    const slug = normalizeSlug(ep.slug).toLowerCase();

    return (
      normalizedName === target ||
      normalizedName === targetPadded ||
      slug === target ||
      slug === targetPadded ||
      slug.includes(`tap-${target}`) ||
      slug.includes(`episode-${target}`)
    );
  });

  if (matched) {
    return matched;
  }

  if (episodeNumber <= episodes.length) {
    return episodes[episodeNumber - 1] ?? null;
  }

  return null;
};

const extractM3U8FromEmbed = (embedUrl?: string): string | null => {
  if (!embedUrl) return null;

  try {
    const parsed = new URL(embedUrl);
    const nested = parsed.searchParams.get('url');
    if (nested?.includes('.m3u8')) {
      return nested;
    }
  } catch {
    // noop
  }

  if (embedUrl.includes('.m3u8')) {
    const match = embedUrl.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/i);
    if (match?.[0]) {
      return match[0];
    }
  }

  return null;
};

const resolveSeasonNumber = (
  tmdbSeason?: number | null,
  ...labels: Array<string | undefined>
): number | null => {
  for (const label of labels) {
    const parsedSeason = parseSeasonFromText(label);
    if (parsedSeason) {
      return parsedSeason;
    }
  }

  if (typeof tmdbSeason === 'number' && Number.isFinite(tmdbSeason)) {
    return tmdbSeason;
  }

  return null;
};

const resolveCandidateSeason = (
  ...candidates: Array<
    | {
        name?: string;
        origin_name?: string;
        slug?: string;
      }
    | undefined
  >
): number | null =>
  resolveSeasonNumber(
    undefined,
    ...candidates.flatMap(candidate => [candidate?.name, candidate?.origin_name, candidate?.slug])
  );

const hasRequestedSeason = (
  requestedSeason: number | null | undefined,
  ...candidates: Array<
    | {
        name?: string;
        origin_name?: string;
        slug?: string;
      }
    | undefined
  >
): boolean => {
  if (typeof requestedSeason !== 'number') {
    return true;
  }

  return resolveCandidateSeason(...candidates) === requestedSeason;
};

const buildServerVariantLabel = (serverName?: string): string => {
  const normalized = normalizeText(serverName ?? '');
  if (normalized.includes('long tieng')) {
    return 'Lồng tiếng';
  }

  if (normalized.includes('vietsub')) {
    return 'Vietsub';
  }

  const compact = (serverName ?? '').replace(/^#+\s*/, '').trim();
  return compact || 'Auto';
};

const buildServerProviderKey = (serverName?: string): string => {
  const label = buildServerVariantLabel(serverName);
  const normalizedLabel = normalizeText(label).replace(/\s+/g, '_');
  return normalizedLabel ? `kkphim_${normalizedLabel}` : 'kkphim';
};

const buildSlugCacheKey = (tmdbId: string, mediaType: 'movie' | 'tv', season?: number | null) =>
  `kkphim:slug:${SLUG_CACHE_KEY_VERSION}:${mediaType}:${tmdbId}:${typeof season === 'number' ? season : 0}`;

const buildNegativeCacheKey = (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number | null
) =>
  `kkphim:notfound:${NEGATIVE_CACHE_KEY_VERSION}:${mediaType}:${tmdbId}:${typeof season === 'number' ? season : 0}`;

const buildSeedCacheKey = (tmdbId: string, mediaType: 'movie' | 'tv') =>
  `kkphim:seed:${SEED_CACHE_KEY_VERSION}:${mediaType}:${tmdbId}`;

const fetchDetailBySlug = async (slug: string): Promise<KKPhimDetailResponse | null> => {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) return null;

  const detailUrl = `${KKPHIM_API_BASE}/phim/${encodeURIComponent(normalizedSlug)}`;
  const detail = await fetchJson<KKPhimDetailResponse>(detailUrl);
  if (!detail?.movie || !Array.isArray(detail.episodes)) {
    return null;
  }

  return detail;
};

const fetchTmdbSeed = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  storage?: StorageLike
): Promise<KKPhimMovieMetadata | null> => {
  if (storage) {
    const cached = await storage.getItem<KKPhimMovieMetadata>(buildSeedCacheKey(tmdbId, mediaType)).catch(() => null);
    if (cached?.slug) {
      return cached;
    }
  }

  const seedUrl = `${KKPHIM_API_BASE}/tmdb/${mediaType}/${encodeURIComponent(tmdbId)}`;
  const seedPayload = await fetchJson<KKPhimDetailResponse>(seedUrl);
  const movie = seedPayload?.movie;
  if (!movie?.slug) {
    return null;
  }

  const resolvedTmdbId = movie.tmdb?.id ? String(movie.tmdb.id) : null;
  if (resolvedTmdbId && resolvedTmdbId !== tmdbId) {
    return null;
  }

  const resolvedType = movie.tmdb?.type;
  if (resolvedType && resolvedType !== mediaType) {
    return null;
  }

  if (storage) {
    await storage
      .setItem(buildSeedCacheKey(tmdbId, mediaType), movie, { ttl: SEED_CACHE_TTL })
      .catch(() => null);
  }

  return movie;
};

const fetchSearchPage = async (
  keyword: string,
  page: number
): Promise<{ items: KKPhimSearchItem[]; totalPages: number }> => {
  const searchUrl =
    `${KKPHIM_API_BASE}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}` +
    `&page=${page}&limit=${SEARCH_PAGE_LIMIT}`;
  const payload = await fetchJson<KKPhimSearchResponse>(searchUrl);
  const items = payload?.data?.items ?? [];
  const totalPagesRaw = payload?.data?.params?.pagination?.totalPages;
  const totalPages =
    typeof totalPagesRaw === 'number' && Number.isFinite(totalPagesRaw) && totalPagesRaw > 0
      ? totalPagesRaw
      : page;

  return { items, totalPages };
};

const getAvailableServers = (detail?: KKPhimDetailResponse | null): KKPhimServerData[] =>
  detail?.episodes?.filter(
    server => Array.isArray(server.server_data) && server.server_data.length > 0
  ) ?? [];

const hasPlayableEpisode = (
  detail: KKPhimDetailResponse | null,
  mediaType: 'movie' | 'tv',
  episodeNumber?: number | null
): boolean =>
  getAvailableServers(detail).some(server => {
    const episodeData = pickEpisode(server.server_data, mediaType, episodeNumber);
    if (!episodeData) {
      return false;
    }

    return Boolean(episodeData.link_m3u8 ?? extractM3U8FromEmbed(episodeData.link_embed));
  });

const hasCompatibleType = (
  movie: KKPhimMovieMetadata | undefined,
  mediaType: 'movie' | 'tv'
): boolean => {
  if (!movie) {
    return false;
  }

  const resolvedType = movie.tmdb?.type;
  if (resolvedType && resolvedType !== mediaType) {
    return false;
  }

  const kkphimType = movie.type;
  if (mediaType === 'movie' && (kkphimType === 'series' || kkphimType === 'tvshows')) {
    return false;
  }
  if (mediaType === 'tv' && kkphimType === 'single') {
    return false;
  }

  return true;
};

const matchesTmdbId = (tmdb: KKPhimTmdbRef | undefined, tmdbId: string): boolean =>
  Boolean(tmdb?.id) && String(tmdb?.id) === tmdbId;

const isAcceptableMovieDetail = (detail: KKPhimDetailResponse | null, tmdbId: string): boolean => {
  if (!detail?.movie || !hasCompatibleType(detail.movie, 'movie')) {
    return false;
  }

  const detailTmdbId = detail.movie.tmdb?.id ? String(detail.movie.tmdb.id) : null;
  if (detailTmdbId && detailTmdbId !== tmdbId) {
    return false;
  }

  return hasPlayableEpisode(detail, 'movie');
};

const isAcceptableTvDetail = (
  detail: KKPhimDetailResponse | null,
  tmdbId: string,
  season: number,
  episode: number,
  candidate?: {
    name?: string;
    origin_name?: string;
    slug?: string;
  }
): boolean => {
  if (!detail?.movie || !hasCompatibleType(detail.movie, 'tv')) {
    return false;
  }

  const detailTmdbId = detail.movie.tmdb?.id ? String(detail.movie.tmdb.id) : null;
  if (detailTmdbId && detailTmdbId !== tmdbId) {
    return false;
  }

  if (!hasRequestedSeason(season, candidate, detail.movie)) {
    return false;
  }

  return hasPlayableEpisode(detail, 'tv', episode);
};

const cacheResolvedSlug = async (
  storage: StorageLike | undefined,
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season: number | null | undefined,
  slug?: string
) => {
  const normalizedSlug = normalizeSlug(slug);
  if (!storage || !normalizedSlug) {
    return;
  }

  await storage
    .setItem(buildSlugCacheKey(tmdbId, mediaType, season), normalizedSlug, { ttl: SLUG_CACHE_TTL })
    .catch(() => null);
};

const resolveFromSlugCandidates = async (
  slugs: string[],
  validate: (detail: KKPhimDetailResponse | null, slug: string) => boolean
): Promise<KKPhimDetailResponse | null> => {
  for (const slug of uniqueValues(slugs.map(normalizeSlug))) {
    const detail = await fetchDetailBySlug(slug);
    if (validate(detail, slug)) {
      return detail;
    }
  }

  return null;
};

const findByCachedSlug = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season: number | null | undefined,
  episode: number | null | undefined,
  storage?: StorageLike
): Promise<KKPhimDetailResponse | null> => {
  if (!storage) return null;

  const cacheKey = buildSlugCacheKey(tmdbId, mediaType, season);
  const cachedSlug = await storage.getItem<string>(cacheKey).catch(() => null);
  const normalizedSlug = normalizeSlug(cachedSlug);
  if (!normalizedSlug) {
    return null;
  }

  console.log(`[KKPhim] Slug cache hit: ${normalizedSlug} for ${mediaType}/${tmdbId}`);
  const detail = await fetchDetailBySlug(normalizedSlug);
  const isValid =
    mediaType === 'movie'
      ? isAcceptableMovieDetail(detail, tmdbId)
      : typeof season === 'number' && typeof episode === 'number'
        ? isAcceptableTvDetail(detail, tmdbId, season, episode)
        : false;

  if (isValid) {
    return detail;
  }

  await storage.removeItem(cacheKey).catch(() => null);
  return null;
};

const findMovieDetailBySearch = async (
  tmdbId: string,
  seed: KKPhimMovieMetadata,
  triedSlugs: Set<string>
): Promise<KKPhimDetailResponse | null> => {
  const keywords = uniqueValues([
    normalizeKeyword(seed.origin_name),
    normalizeKeyword(seed.name),
    normalizeSlug(seed.slug),
  ]);

  for (const keyword of keywords) {
    let totalPages = SEARCH_MAX_PAGES;

    for (let page = 1; page <= Math.min(totalPages, SEARCH_MAX_PAGES); page += 1) {
      const response = await fetchSearchPage(keyword, page);
      totalPages = response.totalPages;

      for (const item of response.items) {
        const slug = normalizeSlug(item.slug);
        if (!slug || triedSlugs.has(slug)) {
          continue;
        }

        triedSlugs.add(slug);
        if (!matchesTmdbId(item.tmdb, tmdbId)) {
          continue;
        }
        if (item.tmdb?.type && item.tmdb.type !== 'movie') {
          continue;
        }

        const detail = await fetchDetailBySlug(slug);
        if (isAcceptableMovieDetail(detail, tmdbId)) {
          return detail;
        }
      }

      if (response.items.length < SEARCH_PAGE_LIMIT) {
        break;
      }
    }
  }

  return null;
};

const findMovieDetail = async (
  tmdbId: string,
  storage?: StorageLike
): Promise<KKPhimDetailResponse | null> => {
  const seed = await fetchTmdbSeed(tmdbId, 'movie', storage);
  if (!seed?.slug) {
    return null;
  }

  const triedSlugs = new Set<string>();
  const directSlug = normalizeSlug(seed.slug);
  if (directSlug) {
    triedSlugs.add(directSlug);
    const directDetail = await fetchDetailBySlug(directSlug);
    if (isAcceptableMovieDetail(directDetail, tmdbId)) {
      return directDetail;
    }
  }

  return findMovieDetailBySearch(tmdbId, seed, triedSlugs);
};

const findTvDetailBySearch = async (
  tmdbId: string,
  season: number,
  episode: number,
  seed: KKPhimMovieMetadata,
  triedSlugs: Set<string>
): Promise<KKPhimDetailResponse | null> => {
  const baseName = stripSeasonText(seed.name);
  const baseOriginName = stripSeasonText(seed.origin_name);
  const keywords = uniqueValues([
    baseOriginName ? `${baseOriginName} Season ${season}` : undefined,
    baseName ? `${baseName} Phần ${season}` : undefined,
    baseOriginName,
    baseName,
    normalizeKeyword(seed.origin_name),
    normalizeKeyword(seed.name),
  ]);

  for (const keyword of keywords) {
    let totalPages = SEARCH_MAX_PAGES;

    for (let page = 1; page <= Math.min(totalPages, SEARCH_MAX_PAGES); page += 1) {
      const response = await fetchSearchPage(keyword, page);
      totalPages = response.totalPages;

      for (const item of response.items) {
        const slug = normalizeSlug(item.slug);
        if (!slug || triedSlugs.has(slug)) {
          continue;
        }

        triedSlugs.add(slug);
        if (!matchesTmdbId(item.tmdb, tmdbId)) {
          continue;
        }
        if (item.tmdb?.type && item.tmdb.type !== 'tv') {
          continue;
        }

        const itemSeason = resolveCandidateSeason(item);
        if (itemSeason != null && itemSeason !== season) {
          continue;
        }

        const detail = await fetchDetailBySlug(slug);
        if (isAcceptableTvDetail(detail, tmdbId, season, episode, item)) {
          return detail;
        }
      }

      if (response.items.length < SEARCH_PAGE_LIMIT) {
        break;
      }
    }
  }

  return null;
};

const findTvDetail = async (
  tmdbId: string,
  season: number,
  episode: number,
  storage?: StorageLike
): Promise<KKPhimDetailResponse | null> => {
  const seed = await fetchTmdbSeed(tmdbId, 'tv', storage);
  if (!seed?.slug) {
    return null;
  }

  const seedSlug = normalizeSlug(seed.slug);
  const seedSeason = resolveCandidateSeason(seed);
  const baseSlug = stripSeasonSlug(seed.slug);
  const triedSlugs = new Set<string>();
  const directCandidates = uniqueValues([
    seedSeason === season ? seedSlug : undefined,
    baseSlug ? `${baseSlug}-phan-${season}` : undefined,
  ]);

  const directDetail = await resolveFromSlugCandidates(directCandidates, (detail, slug) => {
    triedSlugs.add(slug);
    return isAcceptableTvDetail(detail, tmdbId, season, episode);
  });
  if (directDetail) {
    return directDetail;
  }

  return findTvDetailBySearch(tmdbId, season, episode, seed, triedSlugs);
};

const findKKPhimDetail = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number | null,
  episode?: number | null,
  storage?: StorageLike
): Promise<KKPhimDetailResponse | null> => {
  if (storage) {
    const negativeCacheKey = buildNegativeCacheKey(tmdbId, mediaType, season);
    const isNegativelyCached = await storage.getItem<boolean>(negativeCacheKey).catch(() => null);
    if (isNegativelyCached) {
      console.log(`[KKPhim] Negative cache hit for ${mediaType}/${tmdbId} — skipping search`);
      return null;
    }
  }

  const cachedResult = await findByCachedSlug(tmdbId, mediaType, season, episode, storage);
  if (cachedResult) {
    return cachedResult;
  }

  let result: KKPhimDetailResponse | null = null;

  if (mediaType === 'movie') {
    result = await findMovieDetail(tmdbId, storage);
  } else if (typeof season === 'number' && typeof episode === 'number') {
    result = await findTvDetail(tmdbId, season, episode, storage);
  }

  if (result?.movie?.slug) {
    await cacheResolvedSlug(storage, tmdbId, mediaType, season, result.movie.slug);
  }

  if (!result && storage) {
    const negativeCacheKey = buildNegativeCacheKey(tmdbId, mediaType, season);
    await storage
      .setItem(negativeCacheKey, true, { ttl: NEGATIVE_CACHE_TTL })
      .catch(() => null);
    console.log(
      `[KKPhim] Caching negative result for ${mediaType}/${tmdbId} (TTL: ${NEGATIVE_CACHE_TTL}s)`
    );
  }

  return result;
};

export async function getKKPhimStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv' = 'movie',
  seasonNum?: number | null,
  episodeNum?: number | null,
  storage?: StorageLike,
  _context?: StreamLookupContext
): Promise<Stream[]> {
  try {
    const startTime = Date.now();
    const detail = await findKKPhimDetail(tmdbId, mediaType, seasonNum, episodeNum, storage);
    const elapsed = Date.now() - startTime;
    console.log(`[KKPhim] findKKPhimDetail completed in ${elapsed}ms for ${mediaType}/${tmdbId}`);

    const servers = getAvailableServers(detail);
    const streams: Stream[] = [];
    const seenPlaylists = new Set<string>();

    for (const server of servers) {
      const episodeData = pickEpisode(server.server_data, mediaType, episodeNum);
      if (!episodeData) {
        continue;
      }

      const playlist = episodeData.link_m3u8 ?? extractM3U8FromEmbed(episodeData.link_embed) ?? '';
      if (!playlist || seenPlaylists.has(playlist)) {
        continue;
      }

      seenPlaylists.add(playlist);
      const variantLabel = buildServerVariantLabel(server.server_name);

      streams.push({
        name: `KKPhim - ${variantLabel}`,
        title: variantLabel,
        url: playlist,
        subtitle: '',
        quality: '1080p',
        provider: buildServerProviderKey(server.server_name),
        headers: {
          Referer: REFERER,
          Origin: ORIGIN,
          'User-Agent': MODERN_UA,
        },
      });
    }

    return streams;
  } catch (error: unknown) {
    console.error(`[KKPhim] Error: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
