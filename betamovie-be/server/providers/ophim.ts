import type { Stream, StreamLookupContext } from './types';

interface TmdbMetadata {
  titles: string[];
  year?: number;
}

interface OPhimSearchItem {
  name: string;
  origin_name: string;
  slug: string;
  year?: number;
}

interface OPhimEpisodeData {
  name: string;
  slug: string;
  link_embed?: string;
  link_m3u8?: string;
}

interface OPhimServerData {
  server_name: string;
  server_data: OPhimEpisodeData[];
}

interface OPhimDetailItem {
  name: string;
  origin_name: string;
  year?: number;
  tmdb?: {
    id?: string | number | null;
    season?: number | null;
  };
  episodes?: OPhimServerData[];
}

interface OPhimDetailResponse {
  status: string;
  data?: {
    item?: OPhimDetailItem;
  };
}

interface OPhimListItem {
  slug: string;
  name: string;
  origin_name: string;
  year?: number;
  tmdb?: {
    id?: string | number | null;
    season?: number | null;
  };
}

type StorageLike = ReturnType<typeof useStorage>;

const OPHIM_API_BASE = process.env.OPHIM_API_BASE || 'https://ophim1.com/v1/api';
const OPHIM_REFERER = process.env.OPHIM_REFERER || 'https://ophim16.cc/';
const OPHIM_ORIGIN = new URL(OPHIM_REFERER).origin;
const MODERN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = Number(process.env.OPHIM_REQUEST_TIMEOUT_MS || 10_000);
const TMDB_TIMEOUT_MS = Number(process.env.OPHIM_TMDB_TIMEOUT_MS || 6_000);
const LIST_SCAN_MAX_PAGES = Number(process.env.OPHIM_LIST_SCAN_MAX_PAGES || 120);
const SLUG_CACHE_TTL = Number(process.env.OPHIM_SLUG_CACHE_TTL || 24 * 60 * 60);

const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const cleanTitleForMatch = (value: string) =>
  normalizeText(value)
    .replace(/\b(phan|season)\s*\d+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const parseYear = (value?: string) => {
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
    if (nested && nested.includes('.m3u8')) {
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

const fetchTmdbMetadata = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  context?: StreamLookupContext
): Promise<TmdbMetadata> => {
  const titleFromContext = typeof context?.title === 'string' ? context.title.trim() : '';
  const yearFromContext =
    typeof context?.releaseYear === 'number' && Number.isFinite(context.releaseYear)
      ? context.releaseYear
      : undefined;

  if (titleFromContext) {
    return {
      titles: [titleFromContext],
      year: yearFromContext,
    };
  }

  const config = useRuntimeConfig();
  const tmdbKey = ((config.tmdbApiKey as string | undefined) || process.env.TMDB_API_KEY || '').trim();
  if (!tmdbKey) {
    return { titles: [], year: yearFromContext };
  }

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
  if (!payload) {
    return { titles: [], year: yearFromContext };
  }

  const titles = [payload.title, payload.name, payload.original_title, payload.original_name]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim());

  const uniqueTitles = Array.from(new Set(titles));
  const year = parseYear(payload.release_date || payload.first_air_date) || yearFromContext;

  return { titles: uniqueTitles, year };
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

const isTitleMatch = (candidate: OPhimSearchItem, meta: TmdbMetadata) => {
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

const pickEpisode = (
  episodes: OPhimEpisodeData[],
  mediaType: 'movie' | 'tv',
  episodeNumber?: number | null
): OPhimEpisodeData | null => {
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

const fetchDetailBySlug = async (slug: string): Promise<OPhimDetailItem | null> => {
  const detailUrl = `${OPHIM_API_BASE}/phim/${encodeURIComponent(slug)}`;
  const detailResponse = await fetchJson<OPhimDetailResponse>(detailUrl);
  const detail = detailResponse?.data?.item;
  if (!detail || !Array.isArray(detail.episodes)) {
    return null;
  }
  return detail;
};

const buildSlugCacheKey = (tmdbId: string, mediaType: 'movie' | 'tv', season?: number | null) =>
  `ophim:slug:${mediaType}:${tmdbId}:${typeof season === 'number' ? season : 0}`;

const findFromLatestListByTmdb = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number | null,
  storage?: StorageLike
): Promise<OPhimDetailItem | null> => {
  const cacheKey = buildSlugCacheKey(tmdbId, mediaType, season);
  if (storage) {
    const cachedSlug = await storage.getItem<string>(cacheKey).catch(() => null);
    if (cachedSlug) {
      const cachedDetail = await fetchDetailBySlug(cachedSlug);
      if (cachedDetail) {
        return cachedDetail;
      }
    }
  }

  for (let page = 1; page <= LIST_SCAN_MAX_PAGES; page += 1) {
    const listUrl = `${OPHIM_API_BASE}/danh-sach/phim-moi-cap-nhat?page=${page}`;
    const listPayload = await fetchJson<{ data?: { items?: OPhimListItem[] } }>(listUrl);
    const items = listPayload?.data?.items || [];

    if (!items.length) {
      break;
    }

    const matchedItem = items.find(item => {
      const sameTmdb = String(item?.tmdb?.id || '') === tmdbId;
      if (!sameTmdb) return false;

      if (
        mediaType === 'tv' &&
        typeof season === 'number' &&
        typeof item?.tmdb?.season === 'number'
      ) {
        return Number(item.tmdb.season) === season;
      }

      return true;
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

const findOPhimDetail = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number | null,
  context?: StreamLookupContext,
  storage?: StorageLike
): Promise<OPhimDetailItem | null> => {
  const tmdbMeta = await fetchTmdbMetadata(tmdbId, mediaType, context);
  const searchTerms = buildSearchTerms(tmdbMeta, tmdbId);

  let titleFallback: OPhimDetailItem | null = null;
  let seasonFallback: OPhimDetailItem | null = null;

  for (const term of searchTerms) {
    const searchUrl = `${OPHIM_API_BASE}/tim-kiem?keyword=${encodeURIComponent(term)}`;
    const searchPayload = await fetchJson<{ data?: { items?: OPhimSearchItem[] } }>(searchUrl);
    const items = searchPayload?.data?.items || [];

    for (const item of items) {
      const detail = await fetchDetailBySlug(item.slug);
      if (!detail || !Array.isArray(detail.episodes)) {
        continue;
      }

      const detailTmdbId = detail.tmdb?.id ? String(detail.tmdb.id) : null;
      if (detailTmdbId && detailTmdbId === tmdbId) {
        if (mediaType === 'tv' && typeof season === 'number') {
          const seasonFromDetail = detail.tmdb?.season;
          if (typeof seasonFromDetail === 'number' && seasonFromDetail !== season) {
            if (!seasonFallback) {
              seasonFallback = detail;
            }
            continue;
          }
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

  if (titleFallback) {
    return titleFallback;
  }

  if (seasonFallback) {
    return seasonFallback;
  }

  return findFromLatestListByTmdb(tmdbId, mediaType, season, storage);
};

export async function getOPhimStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv' = 'movie',
  seasonNum?: number | null,
  episodeNum?: number | null,
  storage?: StorageLike,
  context?: StreamLookupContext
): Promise<Stream[]> {
  try {
    const detail = await findOPhimDetail(tmdbId, mediaType, seasonNum, context, storage);
    const servers =
      detail?.episodes?.filter(
        server => Array.isArray(server.server_data) && server.server_data.length > 0
      ) || [];

    for (const server of servers) {
      const episodeData = pickEpisode(server.server_data, mediaType, episodeNum);
      if (!episodeData) {
        continue;
      }

      const playlist = episodeData.link_m3u8 || extractM3U8FromEmbed(episodeData.link_embed) || '';
      if (!playlist) {
        continue;
      }

      return [
        {
          name: `OPhim - ${server.server_name || 'Auto'}`,
          title: 'OPhim - High Quality',
          url: playlist,
          subtitle: '',
          quality: '1080p',
          provider: 'ophim',
          headers: {
            Referer: OPHIM_REFERER,
            Origin: OPHIM_ORIGIN,
            'User-Agent': MODERN_UA,
          },
        },
      ];
    }

    return [];
  } catch (error: any) {
    console.error(`[OPhim] Error: ${error?.message || String(error)}`);
    return [];
  }
}
