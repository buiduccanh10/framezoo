/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import type { Stream, StreamLookupContext } from './types';

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
const LIST_SCAN_MAX_PAGES = Number(process.env.KKPHIM_LIST_SCAN_MAX_PAGES ?? 80);
const SLUG_CACHE_TTL = Number(process.env.KKPHIM_SLUG_CACHE_TTL ?? 24 * 60 * 60);

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

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

const findKKPhimDetail = async (
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number | null,
  _context?: StreamLookupContext,
  storage?: StorageLike
): Promise<KKPhimDetailResponse | null> => {
  const detail = await fetchDetailByTmdb(tmdbId, mediaType);
  if (detail && matchesRequestedSeason(season, detail.movie)) {
    if (storage && detail.movie?.slug) {
      const cacheKey = buildSlugCacheKey(tmdbId, mediaType, season);
      await storage.setItem(cacheKey, detail.movie.slug, { ttl: SLUG_CACHE_TTL }).catch(() => null);
    }
    return detail;
  }

  // Keep the fallback TMDB-only to avoid drifting back to fuzzy title matching.
  return findFromLatestListByTmdb(tmdbId, mediaType, season, storage);
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
