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
  country:
    | string
    | Array<{
        name?: string;
        slug?: string;
      }>;
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
const LIST_SCAN_MAX_PAGES = Number(process.env.KKPHIM_LIST_SCAN_MAX_PAGES ?? 20);
const SLUG_CACHE_TTL = Number(process.env.KKPHIM_SLUG_CACHE_TTL ?? 24 * 60 * 60);
const NEGATIVE_CACHE_TTL = Number(process.env.KKPHIM_NEGATIVE_CACHE_TTL ?? 5 * 60);
const TMDB_META_CACHE_TTL = Number(process.env.KKPHIM_TMDB_META_CACHE_TTL ?? 60 * 60);
const LIST_SCAN_BATCH_SIZE = Number(process.env.KKPHIM_LIST_SCAN_BATCH_SIZE ?? 5);
const TITLE_SEARCH_DETAIL_CONCURRENCY = Number(process.env.KKPHIM_TITLE_SEARCH_DETAIL_CONCURRENCY ?? 3);

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

const matchesRequestedSeason = (
  requestedSeason: number | null | undefined,
  candidate?: {
    name?: string;
    origin_name?: string;
    slug?: string;
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
    candidate?.origin_name,
    candidate?.slug
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

const buildNegativeCacheKey = (tmdbId: string, mediaType: 'movie' | 'tv', season?: number | null) =>
  `kkphim:notfound:${mediaType}:${tmdbId}:${typeof season === 'number' ? season : 0}`;

const buildTmdbMetaCacheKey = (tmdbId: string, mediaType: 'movie' | 'tv') =>
  `kkphim:tmdb-meta:${mediaType}:${tmdbId}`;

// ── Cached slug lookup (fast path) ──────────────────────────────────────
const findByCachedSlug = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number | null,
  storage?: StorageLike
): Promise<KKPhimDetailResponse | null> => {
  if (!storage) return null;

  const cacheKey = buildSlugCacheKey(tmdbId, mediaType, season);
  const cachedSlug = await storage.getItem<string>(cacheKey).catch(() => null);
  if (!cachedSlug) return null;

  console.log(`[KKPhim] Slug cache hit: ${cachedSlug} for ${mediaType}/${tmdbId}`);
  const detail = await fetchDetailBySlug(cachedSlug);
  if (detail && matchesRequestedSeason(season, detail.movie)) {
    return detail;
  }

  return null;
};

// ── List scan with batch parallel pages ─────────────────────────────────
const findFromLatestListByTmdb = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number | null,
  storage?: StorageLike
): Promise<KKPhimDetailResponse | null> => {
  for (let batchStart = 1; batchStart <= LIST_SCAN_MAX_PAGES; batchStart += LIST_SCAN_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + LIST_SCAN_BATCH_SIZE - 1, LIST_SCAN_MAX_PAGES);
    const pageNumbers = Array.from(
      { length: batchEnd - batchStart + 1 },
      (_, i) => batchStart + i
    );

    // Fetch batch of pages in parallel
    const pageResults = await Promise.all(
      pageNumbers.map(async page => {
        const listUrl = `${KKPHIM_API_BASE}/danh-sach/phim-moi-cap-nhat?page=${page}`;
        const payload = await fetchJson<{ items?: KKPhimListItem[] }>(listUrl);
        return { page, items: payload?.items || [] };
      })
    );

    let hasEmptyPage = false;

    // Process pages in order to maintain deterministic results
    for (const { items } of pageResults) {
      if (!items.length) {
        hasEmptyPage = true;
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
        const cacheKey = buildSlugCacheKey(tmdbId, mediaType, season);
        await storage.setItem(cacheKey, matchedItem.slug, { ttl: SLUG_CACHE_TTL }).catch(() => null);
      }

      return detail;
    }

    if (hasEmptyPage) {
      break;
    }
  }

  return null;
};

// ── TMDB metadata with caching ──────────────────────────────────────────
const fetchTmdbMetadata = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  context?: StreamLookupContext,
  storage?: StorageLike
): Promise<TmdbMetadata & { country?: string }> => {
  const titleFromContext = typeof context?.title === 'string' ? context.title.trim() : '';
  const originNameFromContext =
    typeof context?.originName === 'string' ? context.originName.trim() : '';
  const yearFromContext =
    typeof context?.releaseYear === 'number' && Number.isFinite(context.releaseYear)
      ? context.releaseYear
      : undefined;
  const countryFromContext = typeof context?.country === 'string' ? context.country.trim() : '';

  // Check TMDB metadata cache first
  if (storage) {
    const metaCacheKey = buildTmdbMetaCacheKey(tmdbId, mediaType);
    const cached = await storage
      .getItem<TmdbMetadata & { country?: string }>(metaCacheKey)
      .catch(() => null);
    if (cached && Array.isArray(cached.titles) && cached.titles.length > 0) {
      // Merge context data into cached result
      const mergedTitles = [...cached.titles];
      if (titleFromContext && !mergedTitles.includes(titleFromContext)) {
        mergedTitles.push(titleFromContext);
      }
      if (originNameFromContext && !mergedTitles.includes(originNameFromContext)) {
        mergedTitles.push(originNameFromContext);
      }
      return {
        titles: mergedTitles,
        year: cached.year || yearFromContext,
        country: cached.country || countryFromContext,
      };
    }
  }

  const config = useRuntimeConfig();
  const tmdbKey = (
    (config.tmdbApiKey as string | undefined) ||
    process.env.TMDB_API_KEY ||
    ''
  ).trim();
  if (tmdbKey) {
    const endpoint = `https://api.themoviedb.org/3/${mediaType}/${encodeURIComponent(tmdbId)}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': MODERN_UA,
    };

    if (tmdbKey.length > 50) {
      headers.Authorization = `Bearer ${tmdbKey}`;
    }

    const buildTmdbUrl = (language: string) => {
      const query = new URLSearchParams({ language });
      if (tmdbKey.length <= 50) {
        query.set('api_key', tmdbKey);
      }
      return `${endpoint}?${query.toString()}`;
    };

    const [viPayloadResult, enPayloadResult] = await Promise.allSettled([
      fetchJson<any>(buildTmdbUrl('vi-VN'), TMDB_TIMEOUT_MS),
      fetchJson<any>(buildTmdbUrl('en-US'), TMDB_TIMEOUT_MS),
    ]);
    const viPayload = viPayloadResult.status === 'fulfilled' ? viPayloadResult.value : null;
    const enPayload = enPayloadResult.status === 'fulfilled' ? enPayloadResult.value : null;
    const primaryPayload = viPayload || enPayload;

    if (primaryPayload || enPayload) {
      const titles = [
        viPayload?.title,
        viPayload?.name,
        enPayload?.title,
        enPayload?.name,
        viPayload?.original_title,
        viPayload?.original_name,
        enPayload?.original_title,
        enPayload?.original_name,
        titleFromContext,
        originNameFromContext,
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map(value => value.trim());

      const uniqueTitles = Array.from(new Set(titles));
      const year =
        parseYear(primaryPayload?.release_date || primaryPayload?.first_air_date) || yearFromContext;
      const country =
        primaryPayload?.origin_country?.[0] ||
        primaryPayload?.production_countries?.[0]?.iso_3166_1 ||
        enPayload?.origin_country?.[0] ||
        enPayload?.production_countries?.[0]?.iso_3166_1 ||
        countryFromContext;

      const result = { titles: uniqueTitles, year, country };

      // Cache the TMDB metadata
      if (storage) {
        const metaCacheKey = buildTmdbMetaCacheKey(tmdbId, mediaType);
        await storage
          .setItem(metaCacheKey, result, { ttl: TMDB_META_CACHE_TTL })
          .catch(() => null);
      }

      return result;
    }
  }

  const titles = [titleFromContext, originNameFromContext].filter(Boolean);
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

const buildSearchTerms = (
  meta: TmdbMetadata,
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number | null
): string[] => {
  const terms = new Set<string>();
  const titles = Array.from(
    new Set(meta.titles.map(title => title.trim()).filter(title => title.length > 0))
  ).sort((a, b) => b.length - a.length);

  const push = (value?: string) => {
    const normalized = value?.trim();
    if (normalized) {
      terms.add(normalized);
    }
  };

  for (const title of titles) {
    push(title);

    const stripped = title.replace(/[:|].*$/, '').trim();
    if (stripped && stripped !== title) {
      push(stripped);
    }

    if (mediaType === 'tv' && typeof season === 'number' && season > 0) {
      if (!parseSeasonFromText(title)) {
        push(`${title} Phần ${season}`);
        if (stripped && stripped !== title) {
          push(`${stripped} Phần ${season}`);
        }
      }
    }
  }

  push(tmdbId);

  return Array.from(terms);
};

const getTitleMatchScore = (candidate: KKPhimSearchItem, meta: TmdbMetadata) => {
  const candidateTitles = [candidate.name, candidate.origin_name]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(cleanTitleForMatch);

  if (candidateTitles.length === 0 || meta.titles.length === 0) {
    return 0;
  }

  let bestScore = 0;

  for (const title of meta.titles) {
    const normalizedTarget = cleanTitleForMatch(title);
    if (!normalizedTarget) continue;

    for (const candidateTitle of candidateTitles) {
      if (candidateTitle === normalizedTarget) {
        bestScore = Math.max(bestScore, 100);
        continue;
      }

      if (
        candidateTitle.startsWith(normalizedTarget) ||
        normalizedTarget.startsWith(candidateTitle)
      ) {
        bestScore = Math.max(bestScore, 75);
        continue;
      }

      if (candidateTitle.includes(normalizedTarget) || normalizedTarget.includes(candidateTitle)) {
        bestScore = Math.max(bestScore, 55);
      }
    }
  }

  return bestScore;
};

// ── Pre-filter and validate a search candidate ──────────────────────────
const validateCandidate = (
  detail: KKPhimDetailResponse,
  item: KKPhimSearchItem,
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  tmdbMeta: TmdbMetadata & { country?: string }
): { valid: boolean; tmdbMatch: boolean } => {
  if (!detail?.movie || !Array.isArray(detail.episodes)) {
    return { valid: false, tmdbMatch: false };
  }

  // 1. Strict year matching
  const tmdbYear = tmdbMeta.year;
  const candidateYear = detail.movie.year || item.year;
  if (tmdbYear && candidateYear && Math.abs(candidateYear - tmdbYear) > 1) {
    return { valid: false, tmdbMatch: false };
  }

  // 2. Strict media type validation
  const resolvedType = detail.movie.tmdb?.type;
  if (resolvedType && resolvedType !== mediaType) {
    return { valid: false, tmdbMatch: false };
  }
  const kkphimType = detail.movie.type;
  if (kkphimType) {
    if (mediaType === 'movie' && (kkphimType === 'series' || kkphimType === 'tvshows')) {
      return { valid: false, tmdbMatch: false };
    }
    if (mediaType === 'tv' && kkphimType === 'single') {
      return { valid: false, tmdbMatch: false };
    }
  }

  // 3. Strict country validation
  const targetCountrySlug = mapIsoCountryToKkphimSlug(tmdbMeta.country);
  if (targetCountrySlug && Array.isArray(detail.movie.country)) {
    const hasCountryMatch = detail.movie.country.some((c: any) => c.slug === targetCountrySlug);
    if (!hasCountryMatch) {
      return { valid: false, tmdbMatch: false };
    }
  }

  // Check TMDB ID match
  const detailTmdbId = detail.movie.tmdb?.id ? String(detail.movie.tmdb.id) : null;
  if (detailTmdbId && detailTmdbId === tmdbId) {
    return { valid: true, tmdbMatch: true };
  }

  return { valid: true, tmdbMatch: false };
};

// ── Title search with parallel candidate detail fetching ────────────────
const findByTitleSearch = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number | null,
  context?: StreamLookupContext,
  storage?: StorageLike
): Promise<KKPhimDetailResponse | null> => {
  const tmdbMeta = await fetchTmdbMetadata(tmdbId, mediaType, context, storage);
  const searchTerms = buildSearchTerms(tmdbMeta, tmdbId, mediaType, season);

  let titleFallback: KKPhimDetailResponse | null = null;
  let titleFallbackScore = 0;

  for (const term of searchTerms) {
    const searchUrl = `${KKPHIM_API_BASE}/v1/api/tim-kiem?keyword=${encodeURIComponent(term)}`;
    const searchPayload = await fetchJson<{ data?: { items?: KKPhimSearchItem[] } }>(searchUrl);
    const items = searchPayload?.data?.items || [];

    // Pre-filter: separate items with matching TMDB ID (priority) from others
    const tmdbMatchItems: KKPhimSearchItem[] = [];
    const otherItems: KKPhimSearchItem[] = [];

    for (const item of items) {
      const itemTmdbId = item.tmdb?.id ? String(item.tmdb.id) : null;
      if (itemTmdbId && itemTmdbId !== tmdbId) {
        continue; // Different TMDB ID — skip entirely
      }
      if (itemTmdbId === tmdbId) {
        tmdbMatchItems.push(item);
      } else {
        otherItems.push(item);
      }
    }

    tmdbMatchItems.sort((left, right) => {
      const leftSeason = resolveSeasonNumber(undefined, left.name, left.origin_name, left.slug);
      const rightSeason = resolveSeasonNumber(undefined, right.name, right.origin_name, right.slug);

      if (typeof season === 'number') {
        const leftDistance = leftSeason == null ? Number.POSITIVE_INFINITY : Math.abs(leftSeason - season);
        const rightDistance =
          rightSeason == null ? Number.POSITIVE_INFINITY : Math.abs(rightSeason - season);
        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance;
        }
      }

      const leftYearDistance =
        tmdbMeta.year && left.year ? Math.abs(left.year - tmdbMeta.year) : Number.POSITIVE_INFINITY;
      const rightYearDistance =
        tmdbMeta.year && right.year ? Math.abs(right.year - tmdbMeta.year) : Number.POSITIVE_INFINITY;
      return leftYearDistance - rightYearDistance;
    });

    // Process TMDB-matched items first (fetch details in parallel, limited concurrency)
    if (tmdbMatchItems.length > 0) {
      const detailResults = await Promise.all(
        tmdbMatchItems.slice(0, TITLE_SEARCH_DETAIL_CONCURRENCY).map(async item => {
          const detail = await fetchDetailBySlug(item.slug);
          return { item, detail };
        })
      );

      for (const { item, detail } of detailResults) {
        if (!detail) continue;

        const { valid, tmdbMatch } = validateCandidate(detail, item, tmdbId, mediaType, tmdbMeta);
        if (!valid) continue;

        if (tmdbMatch) {
          if (!matchesRequestedSeason(season, { ...detail.movie, slug: detail.movie?.slug })) {
            continue;
          }

          if (storage && detail.movie?.slug) {
            const cacheKey = buildSlugCacheKey(tmdbId, mediaType, season);
            await storage
              .setItem(cacheKey, detail.movie.slug, { ttl: SLUG_CACHE_TTL })
              .catch(() => null);
          }
          return detail;
        }
      }
    }

    // Process remaining items (title fallback) — fetch details in parallel batches
    if (otherItems.length > 0) {
      const candidatesToCheck = [...otherItems]
        .sort((left, right) => {
          const scoreDelta = getTitleMatchScore(right, tmdbMeta) - getTitleMatchScore(left, tmdbMeta);
          if (scoreDelta !== 0) {
            return scoreDelta;
          }

          const leftYearDistance =
            tmdbMeta.year && left.year
              ? Math.abs(left.year - tmdbMeta.year)
              : Number.POSITIVE_INFINITY;
          const rightYearDistance =
            tmdbMeta.year && right.year
              ? Math.abs(right.year - tmdbMeta.year)
              : Number.POSITIVE_INFINITY;
          return leftYearDistance - rightYearDistance;
        })
        .slice(0, TITLE_SEARCH_DETAIL_CONCURRENCY);
      const detailResults = await Promise.all(
        candidatesToCheck.map(async item => {
          const detail = await fetchDetailBySlug(item.slug);
          return { item, detail };
        })
      );

      for (const { item, detail } of detailResults) {
        if (!detail) continue;

        const { valid, tmdbMatch } = validateCandidate(detail, item, tmdbId, mediaType, tmdbMeta);
        if (!valid) continue;

        if (tmdbMatch) {
          if (!matchesRequestedSeason(season, { ...detail.movie, slug: detail.movie?.slug })) {
            continue;
          }

          if (storage && detail.movie?.slug) {
            const cacheKey = buildSlugCacheKey(tmdbId, mediaType, season);
            await storage
              .setItem(cacheKey, detail.movie.slug, { ttl: SLUG_CACHE_TTL })
              .catch(() => null);
          }
          return detail;
        }

        const titleMatchScore = getTitleMatchScore(item, tmdbMeta);
        if (titleMatchScore >= 75) {
          if (mediaType === 'movie') {
            if (!tmdbMeta.year || !item.year || item.year === tmdbMeta.year) {
              if (!titleFallback || titleMatchScore > titleFallbackScore) {
                titleFallback = detail;
                titleFallbackScore = titleMatchScore;
              }
            }
          } else {
            const seasonFromTitle = resolveSeasonNumber(
              undefined,
              item.name,
              item.origin_name,
              item.slug,
              detail.movie?.name,
              detail.movie?.origin_name,
              detail.movie?.slug
            );
            if (!season || !seasonFromTitle || seasonFromTitle === season) {
              if (!titleFallback || titleMatchScore > titleFallbackScore) {
                titleFallback = detail;
                titleFallbackScore = titleMatchScore;
              }
            }
          }
        }
      }
    }
  }

  return titleFallback ?? null;
};

// ── Main orchestrator with all strategies in parallel ───────────────────
const findKKPhimDetail = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number | null,
  context?: StreamLookupContext,
  storage?: StorageLike
): Promise<KKPhimDetailResponse | null> => {
  // 0. Check negative cache — avoid repeating expensive lookups for missing content
  if (storage) {
    const negativeCacheKey = buildNegativeCacheKey(tmdbId, mediaType, season);
    const isNegativelyCached = await storage.getItem<boolean>(negativeCacheKey).catch(() => null);
    if (isNegativelyCached) {
      console.log(`[KKPhim] Negative cache hit for ${mediaType}/${tmdbId} — skipping search`);
      return null;
    }
  }

  // 1. Fast path: check slug cache first (1 request instead of full search)
  const cachedResult = await findByCachedSlug(tmdbId, mediaType, season, storage);
  if (cachedResult) {
    return cachedResult;
  }

  // 2. Run all 3 strategies in parallel: TMDB direct + list scan + title search
  const [tmdbSettled, listSettled, titleSettled] = await Promise.allSettled([
    fetchDetailByTmdb(tmdbId, mediaType),
    findFromLatestListByTmdb(tmdbId, mediaType, season, storage),
    findByTitleSearch(tmdbId, mediaType, season, context, storage),
  ]);

  const tmdbResult = tmdbSettled.status === 'fulfilled' ? tmdbSettled.value : null;
  const listResult = listSettled.status === 'fulfilled' ? listSettled.value : null;
  const titleResult = titleSettled.status === 'fulfilled' ? titleSettled.value : null;

  // Prioritize: TMDB direct (most reliable) > list scan > title search
  let result: KKPhimDetailResponse | null = null;

  if (tmdbResult && matchesRequestedSeason(season, tmdbResult.movie)) {
    result = tmdbResult;
  } else {
    result = listResult ?? titleResult ?? null;
  }

  // Cache the slug for future fast lookups
  if (result?.movie?.slug && storage) {
    const cacheKey = buildSlugCacheKey(tmdbId, mediaType, season);
    await storage.setItem(cacheKey, result.movie.slug, { ttl: SLUG_CACHE_TTL }).catch(() => null);
  }

  // Negative cache if not found
  if (!result && storage) {
    const negativeCacheKey = buildNegativeCacheKey(tmdbId, mediaType, season);
    await storage
      .setItem(negativeCacheKey, true, { ttl: NEGATIVE_CACHE_TTL })
      .catch(() => null);
    console.log(`[KKPhim] Caching negative result for ${mediaType}/${tmdbId} (TTL: ${NEGATIVE_CACHE_TTL}s)`);
  }

  return result;
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
    const startTime = Date.now();
    const detail = await findKKPhimDetail(tmdbId, mediaType, seasonNum, context, storage);
    const elapsed = Date.now() - startTime;
    console.log(`[KKPhim] findKKPhimDetail completed in ${elapsed}ms for ${mediaType}/${tmdbId}`);

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
