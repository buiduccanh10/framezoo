/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import type { Stream, StreamLookupContext } from './types';

interface TmdbMetadata {
  titles: string[];
  year?: number;
}

interface KKPhimSearchItem {
  name: string;
  origin_name: string;
  slug: string;
  year?: number;
  tmdb?: {
    type?: 'movie' | 'tv' | null;
    id?: string | number | null;
    season?: number | null;
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

interface KKPhimDetailMovie {
  name: string;
  origin_name: string;
  country: string;
  type: string;
  slug?: string;
  year?: number;
  tmdb?: {
    type?: 'movie' | 'tv' | null;
    id?: string | number | null;
    season?: number | null;
  };
}

interface KKPhimDetailResponse {
  status: boolean;
  movie?: KKPhimDetailMovie;
  episodes?: KKPhimServerData[];
}

interface KKPhimListItem {
  slug: string;
  name: string;
  origin_name: string;
  year?: number;
  tmdb?: {
    type?: 'movie' | 'tv' | null;
    id?: string | number | null;
    season?: number | null;
  };
}

type StorageLike = ReturnType<typeof useStorage>;

const KKPHIM_API_BASE = process.env.KKPHIM_API_BASE || 'https://phimapi.com';
const REFERER = `${new URL(KKPHIM_API_BASE).origin}/`;
const ORIGIN = new URL(KKPHIM_API_BASE).origin;
const MODERN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = Number(process.env.KKPHIM_REQUEST_TIMEOUT_MS ?? 10_000);
const TMDB_TIMEOUT_MS = Number(process.env.KKPHIM_TMDB_TIMEOUT_MS ?? 6_000);
const LIST_SCAN_MAX_PAGES = Number(process.env.KKPHIM_LIST_SCAN_MAX_PAGES ?? 80);
const SLUG_CACHE_TTL = Number(process.env.KKPHIM_SLUG_CACHE_TTL ?? 24 * 60 * 60);

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const cleanTitleForMatch = (value: string): string =>
  normalizeText(value)
    .replace(/\b(phan|season)\s*\d+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const parseYear = (value?: string): number | undefined => {
  if (!value || value.length < 4) return undefined;
  const parsed = Number.parseInt(value.slice(0, 4), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseSeasonFromText = (value?: string): number | null => {
  if (!value) return null;
  const match = normalizeText(value).match(/(?:phan|season)\s*(\d{1,2})/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
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
    const slug = (ep.slug || '').toLowerCase();

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

const resolveSeasonNumber = (
  tmdbSeason?: number | null,
  ...labels: Array<string | undefined>
): number | null => {
  if (typeof tmdbSeason === 'number' && Number.isFinite(tmdbSeason)) {
    return tmdbSeason;
  }

  for (const label of labels) {
    const parsedSeason = parseSeasonFromText(label);
    if (parsedSeason) {
      return parsedSeason;
    }
  }

  return null;
};

const matchesRequestedSeason = (
  requestedSeason: number | null | undefined,
  candidate?: {
    name?: string;
    origin_name?: string;
    tmdb?: {
      season?: number | null;
    };
  }
): boolean => {
  if (typeof requestedSeason !== 'number') {
    return true;
  }

  const resolvedSeason = resolveSeasonNumber(
    candidate?.tmdb?.season,
    candidate?.name,
    candidate?.origin_name
  );

  return resolvedSeason == null || resolvedSeason === requestedSeason;
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

const fetchDetailBySlug = async (slug: string): Promise<KKPhimDetailResponse | null> => {
  const detailUrl = `${KKPHIM_API_BASE}/phim/${encodeURIComponent(slug)}`;
  const detail = await fetchJson<KKPhimDetailResponse>(detailUrl);
  if (!detail?.movie || !Array.isArray(detail.episodes)) {
    return null;
  }
  return detail;
};

const fetchDetailByTmdb = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<KKPhimDetailResponse | null> => {
  const detailUrl = `${KKPHIM_API_BASE}/tmdb/${mediaType}/${encodeURIComponent(tmdbId)}`;
  const detail = await fetchJson<KKPhimDetailResponse>(detailUrl);
  if (!detail?.movie || !Array.isArray(detail.episodes)) {
    return null;
  }

  const resolvedTmdbId = detail.movie.tmdb?.id ? String(detail.movie.tmdb.id) : null;
  if (resolvedTmdbId !== tmdbId) {
    return null;
  }

  const resolvedType = detail.movie.tmdb?.type;
  if (resolvedType && resolvedType !== mediaType) {
    return null;
  }

  return detail;
};

const buildSlugCacheKey = (tmdbId: string, mediaType: 'movie' | 'tv', season?: number | null) =>
  `kkphim:slug:${mediaType}:${tmdbId}:${typeof season === 'number' ? season : 0}`;

const findFromLatestListByTmdb = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number | null,
  storage?: StorageLike
): Promise<KKPhimDetailResponse | null> => {
  const cacheKey = buildSlugCacheKey(tmdbId, mediaType, season);
  if (storage) {
    const cachedSlug = await storage.getItem<string>(cacheKey).catch(() => null);
    if (cachedSlug) {
      const cachedDetail = await fetchDetailBySlug(cachedSlug);
      if (cachedDetail && matchesRequestedSeason(season, cachedDetail.movie)) {
        return cachedDetail;
      }
    }
  }

  for (let page = 1; page <= LIST_SCAN_MAX_PAGES; page += 1) {
    const listUrl = `${KKPHIM_API_BASE}/danh-sach/phim-moi-cap-nhat?page=${page}`;
    const listPayload = await fetchJson<{ items?: KKPhimListItem[] }>(listUrl);
    const items = listPayload?.items || [];

    if (!items.length) {
      break;
    }

    const matchedItem = items.find(item => {
      const sameTmdb = String(item?.tmdb?.id ?? '') === tmdbId;
      if (!sameTmdb) return false;

      const sameType = !item?.tmdb?.type || item.tmdb.type === mediaType;
      if (!sameType) {
        return false;
      }

      return matchesRequestedSeason(season, item);
    });

    if (!matchedItem?.slug) {
      continue;
    }

    const detail = await fetchDetailBySlug(matchedItem.slug);
    if (!detail) {
      continue;
    }

    if (storage) {
      await storage.setItem(cacheKey, matchedItem.slug, { ttl: SLUG_CACHE_TTL }).catch(() => null);
    }

    return detail;
  }

  return null;
};

const fetchTmdbMetadata = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  context?: StreamLookupContext
): Promise<TmdbMetadata & { country?: string }> => {
  const titleFromContext = typeof context?.title === 'string' ? context.title.trim() : '';
  const yearFromContext =
    typeof context?.releaseYear === 'number' && Number.isFinite(context.releaseYear)
      ? context.releaseYear
      : undefined;
  const countryFromContext = typeof context?.country === 'string' ? context.country.trim() : '';

  const config = useRuntimeConfig();
  const tmdbKey = (
    (config.tmdbApiKey as string | undefined) ||
    process.env.TMDB_API_KEY ||
    ''
  ).trim();
  if (tmdbKey) {
    const endpoint = `https://api.themoviedb.org/3/${mediaType}/${encodeURIComponent(tmdbId)}`;
    const query = new URLSearchParams({ language: 'vi-VN' });
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': MODERN_UA,
    };

    if (tmdbKey.length > 50) {
      headers.Authorization = `Bearer ${tmdbKey}`;
    } else {
      query.set('api_key', tmdbKey);
    }

    const payload = await fetchJson<any>(`${endpoint}?${query.toString()}`, TMDB_TIMEOUT_MS);
    if (payload) {
      const titles = [
        payload.title,
        payload.name,
        payload.original_title,
        payload.original_name,
        titleFromContext,
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map(value => value.trim());

      const uniqueTitles = Array.from(new Set(titles));
      const year = parseYear(payload.release_date || payload.first_air_date) || yearFromContext;
      const country =
        payload.origin_country?.[0] ||
        payload.production_countries?.[0]?.iso_3166_1 ||
        countryFromContext;

      return { titles: uniqueTitles, year, country };
    }
  }

  const titles = [titleFromContext].filter(Boolean);
  return {
    titles,
    year: yearFromContext,
    country: countryFromContext,
  };
};

const mapIsoCountryToKkphimSlug = (isoCode?: string): string | null => {
  if (!isoCode) return null;
  const normalized = isoCode.trim().toUpperCase();

  if (normalized === 'KR') return 'han-quoc';
  if (normalized === 'VN') return 'viet-nam';
  if (normalized === 'CN') return 'trung-quoc';
  if (normalized === 'TW') return 'dai-loan';
  if (normalized === 'JP') return 'nhat-ban';
  if (normalized === 'TH') return 'thai-lan';
  if (normalized === 'IN') return 'an-do';
  if (normalized === 'HK') return 'hong-kong';

  const auMyCodes = ['US', 'GB', 'CA', 'FR', 'DE', 'IT', 'ES', 'AU', 'NZ', 'RU'];
  if (auMyCodes.includes(normalized)) {
    return 'au-my';
  }

  return null;
};

const buildSearchTerms = (meta: TmdbMetadata, tmdbId: string): string[] => {
  const terms = new Set<string>();

  for (const title of meta.titles) {
    terms.add(title);
  }

  if (meta.titles.length > 0) {
    terms.add(meta.titles[0].replace(/[:|].*$/, '').trim());
  }

  terms.add(tmdbId);

  return Array.from(terms).filter(term => term.length > 0);
};

const isTitleMatch = (candidate: KKPhimSearchItem, meta: TmdbMetadata) => {
  const candidateTitles = [candidate.name, candidate.origin_name]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(cleanTitleForMatch);

  if (candidateTitles.length === 0 || meta.titles.length === 0) {
    return false;
  }

  for (const title of meta.titles) {
    const normalizedTarget = cleanTitleForMatch(title);
    if (!normalizedTarget) continue;

    for (const candidateTitle of candidateTitles) {
      if (candidateTitle.includes(normalizedTarget) || normalizedTarget.includes(candidateTitle)) {
        return true;
      }
    }
  }

  return false;
};

const findByTitleSearch = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number | null,
  context?: StreamLookupContext,
  storage?: StorageLike
): Promise<KKPhimDetailResponse | null> => {
  const tmdbMeta = await fetchTmdbMetadata(tmdbId, mediaType, context);
  const searchTerms = buildSearchTerms(tmdbMeta, tmdbId);

  let titleFallback: KKPhimDetailResponse | null = null;
  let seasonFallback: KKPhimDetailResponse | null = null;

  for (const term of searchTerms) {
    const searchUrl = `${KKPHIM_API_BASE}/v1/api/tim-kiem?keyword=${encodeURIComponent(term)}`;
    const searchPayload = await fetchJson<{ data?: { items?: KKPhimSearchItem[] } }>(searchUrl);
    const items = searchPayload?.data?.items || [];

    for (const item of items) {
      const itemTmdbId = item.tmdb?.id ? String(item.tmdb.id) : null;
      if (itemTmdbId && itemTmdbId !== tmdbId) {
        continue;
      }

      const detail = await fetchDetailBySlug(item.slug);
      if (!detail?.movie || !Array.isArray(detail.episodes)) {
        continue;
      }

      // 1. Strict year matching
      const tmdbYear = tmdbMeta.year;
      const candidateYear = detail.movie.year || item.year;
      if (tmdbYear && candidateYear && Math.abs(candidateYear - tmdbYear) > 1) {
        continue;
      }

      // 2. Strict media type validation
      const resolvedType = detail.movie.tmdb?.type;
      if (resolvedType && resolvedType !== mediaType) {
        continue;
      }
      const kkphimType = detail.movie.type;
      if (kkphimType) {
        if (mediaType === 'movie' && (kkphimType === 'series' || kkphimType === 'tvshows')) {
          continue;
        }
        if (mediaType === 'tv' && kkphimType === 'single') {
          continue;
        }
      }

      // 3. Strict country validation
      const targetCountrySlug = mapIsoCountryToKkphimSlug(tmdbMeta.country);
      if (targetCountrySlug && Array.isArray(detail.movie.country)) {
        const hasCountryMatch = detail.movie.country.some((c: any) => c.slug === targetCountrySlug);
        if (!hasCountryMatch) {
          continue;
        }
      }

      const detailTmdbId = detail.movie.tmdb?.id ? String(detail.movie.tmdb.id) : null;
      if (detailTmdbId && detailTmdbId === tmdbId) {
        if (mediaType === 'tv' && typeof season === 'number') {
          const seasonFromDetail = detail.movie.tmdb?.season;
          if (typeof seasonFromDetail === 'number' && seasonFromDetail !== season) {
            if (!seasonFallback) {
              seasonFallback = detail;
            }
            continue;
          }
        }

        if (storage && detail.movie.slug) {
          const cacheKey = buildSlugCacheKey(tmdbId, mediaType, season);
          await storage
            .setItem(cacheKey, detail.movie.slug, { ttl: SLUG_CACHE_TTL })
            .catch(() => null);
        }
        return detail;
      }

      if (!titleFallback && isTitleMatch(item, tmdbMeta)) {
        if (mediaType === 'movie') {
          if (!tmdbMeta.year || !item.year || item.year === tmdbMeta.year) {
            titleFallback = detail;
          }
        } else {
          const seasonFromTitle =
            parseSeasonFromText(item.name) || parseSeasonFromText(item.origin_name);
          if (!season || !seasonFromTitle || seasonFromTitle === season) {
            titleFallback = detail;
          }
        }
      }
    }
  }

  return titleFallback ?? seasonFallback ?? null;
};

const findKKPhimDetail = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number | null,
  context?: StreamLookupContext,
  storage?: StorageLike
): Promise<KKPhimDetailResponse | null> => {
  // 1. Direct TMDB ID lookup (fastest, most reliable).
  const detail = await fetchDetailByTmdb(tmdbId, mediaType);
  if (detail && matchesRequestedSeason(season, detail.movie)) {
    if (storage && detail.movie?.slug) {
      const cacheKey = buildSlugCacheKey(tmdbId, mediaType, season);
      await storage.setItem(cacheKey, detail.movie.slug, { ttl: SLUG_CACHE_TTL }).catch(() => null);
    }
    return detail;
  }

  // 2. Run list scan (TMDB ID) and title search in parallel.
  const [listSettled, titleSettled] = await Promise.allSettled([
    findFromLatestListByTmdb(tmdbId, mediaType, season, storage),
    findByTitleSearch(tmdbId, mediaType, season, context, storage),
  ]);

  const listResult = listSettled.status === 'fulfilled' ? listSettled.value : null;
  const titleResult = titleSettled.status === 'fulfilled' ? titleSettled.value : null;

  return listResult ?? titleResult ?? null;
};

export async function getKKPhimStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv' = 'movie',
  seasonNum?: number | null,
  episodeNum?: number | null,
  storage?: StorageLike,
  context?: StreamLookupContext
): Promise<Stream[]> {
  try {
    const detail = await findKKPhimDetail(tmdbId, mediaType, seasonNum, context, storage);
    const servers =
      detail?.episodes?.filter(
        server => Array.isArray(server.server_data) && server.server_data.length > 0
      ) ?? [];
    const streams: Stream[] = [];
    const seenPlaylists = new Set<string>();

    for (const server of servers) {
      const episodeData = pickEpisode(server.server_data, mediaType, episodeNum);
      if (!episodeData) {
        continue;
      }

      const playlist = episodeData.link_m3u8 ?? extractM3U8FromEmbed(episodeData.link_embed) ?? '';
      if (!playlist) {
        continue;
      }

      if (seenPlaylists.has(playlist)) {
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
