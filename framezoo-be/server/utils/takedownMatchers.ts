import type { TakedownTargetType } from './legalConstants';

export interface TakedownRuleLike {
  target_type: string;
  pattern: string;
}

export interface TakedownBlocklist {
  addonDomains: string[];
  tmdbIds: string[];
  imdbIds: string[];
  subtitleIds: string[];
  infohashes: string[];
  updatedAt: string;
}

export function extractDomainHost(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  const withoutScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withoutScheme);
    const hostname = parsed.hostname.replace(/\.+$/, '');
    return hostname || null;
  } catch {
    return null;
  }
}

export function normalizeTakedownPattern(targetType: TakedownTargetType, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  if (targetType === 'addon_domain') {
    return extractDomainHost(trimmed) || trimmed.toLowerCase();
  }

  return trimmed.toLowerCase();
}

export function groupTakedownRules(rules: TakedownRuleLike[]): TakedownBlocklist {
  const sets: Record<TakedownTargetType, Set<string>> = {
    addon_domain: new Set(),
    tmdb_id: new Set(),
    imdb_id: new Set(),
    subtitle_id: new Set(),
    infohash: new Set(),
  };

  for (const rule of rules) {
    const targetType = rule.target_type as TakedownTargetType;
    if (!(targetType in sets)) continue;
    const normalized = normalizeTakedownPattern(targetType, rule.pattern);
    if (normalized) sets[targetType].add(normalized);
  }

  return {
    addonDomains: [...sets.addon_domain],
    tmdbIds: [...sets.tmdb_id],
    imdbIds: [...sets.imdb_id],
    subtitleIds: [...sets.subtitle_id],
    infohashes: [...sets.infohash],
    updatedAt: new Date().toISOString(),
  };
}

type OptStr = string | null | undefined;
type OptId = string | number | null | undefined;
type MediaKind = 'movie' | 'tv';
type MediaKindOrSeries = MediaKind | 'series';
type IdBlocklist = Pick<TakedownBlocklist, 'tmdbIds' | 'imdbIds'>;
type MediaRecord = Record<string, unknown>;
type OptRecord = MediaRecord | null | undefined;
type DiscoverSection = { movies?: MediaRecord[]; shows?: MediaRecord[] };
type Discover = {
  popular?: DiscoverSection;
  topRated?: DiscoverSection;
  nowPlaying?: DiscoverSection;
  top10?: DiscoverSection;
  latesttv?: { shows?: MediaRecord[] };
};
type Feed = { movie_tmdb_ids: number[]; tv_tmdb_ids: number[]; count: number };
type Curated = { tmdbIds: number[]; count: number };
type AddonResult<T> = { addons: T[]; removedCount: number };

export function isDomainBlocked(urlOrHost: OptStr, blockedDomains: string[]): boolean {
  if (!urlOrHost || blockedDomains.length === 0) return false;
  const host = extractDomainHost(urlOrHost);
  if (!host) return false;

  return blockedDomains.some(pattern => {
    const normalized = pattern.trim().toLowerCase().replace(/^\*\./, '');
    if (!normalized) return false;
    return host === normalized || host.endsWith(`.${normalized}`);
  });
}

export function isTmdbBlocked(tmdbId: OptId, blocked: string[], kind?: MediaKindOrSeries): boolean {
  if (tmdbId == null || blocked.length === 0) return false;
  const raw = String(tmdbId).trim().toLowerCase();
  if (!raw) return false;

  const bareId = raw.replace(/^(movie|tv|series):/, '');
  const candidates = new Set([raw, bareId]);
  if (kind) {
    candidates.add(`${kind}:${bareId}`);
    if (kind === 'series') candidates.add(`tv:${bareId}`);
    if (kind === 'tv') candidates.add(`series:${bareId}`);
  } else {
    candidates.add(`movie:${bareId}`);
    candidates.add(`tv:${bareId}`);
    candidates.add(`series:${bareId}`);
  }

  return blocked.some(entry => candidates.has(entry.trim().toLowerCase()));
}

export function isImdbBlocked(imdbId: OptStr, blockedImdbIds: string[]): boolean {
  if (!imdbId || blockedImdbIds.length === 0) return false;
  const clean = imdbId.trim().toLowerCase().split(':')[0];
  if (!clean) return false;

  return blockedImdbIds.some(entry => entry.trim().toLowerCase() === clean);
}

export function isSubtitleIdBlocked(subtitleId: OptStr, blockedSubtitleIds: string[]): boolean {
  if (!subtitleId || blockedSubtitleIds.length === 0) return false;
  const normalized = subtitleId.trim().toLowerCase();
  if (!normalized) return false;

  // Match composite ids (`subsource:123:vi`, `opensubs:456:en`, `wyzie:opensubtitles:789:en:...`),
  // download prefixes (`subsource:123`, `opensubs:456`), URLs, or numeric provider ids (`123`).
  const segments = normalized.split(':');
  const inputProvider = segments.length >= 2 ? segments[0] : null;
  const bareNumericId =
    inputProvider === 'wyzie' && segments.length >= 3 && segments[2]
      ? segments[2]
      : segments.length >= 2
        ? segments[1]
        : normalized;

  return blockedSubtitleIds.some(entry => {
    const pattern = entry.trim().toLowerCase();
    if (!pattern) return false;
    if (pattern === normalized) return true;
    if (bareNumericId && pattern === bareNumericId) return true;
    if (/^https?:\/\//.test(pattern) && normalized.endsWith(`:${pattern}`)) return true;

    const entrySegments = pattern.split(':');
    const entryProvider = entrySegments.length >= 2 ? entrySegments[0] : null;
    if (entryProvider && inputProvider && entryProvider === inputProvider) {
      if (normalized.startsWith(`${pattern}:`) || pattern.startsWith(`${normalized}:`)) {
        return true;
      }
    }
    return pattern === `subsource:${bareNumericId}`;
  });
}

export function extractBlockedTmdbPathTarget(path: string): {
  mediaType?: MediaKind;
  tmdbId?: string;
  imdbId?: string;
} {
  const clean = path.replace(/^\/+|\/+$/g, '');
  const movieMatch = clean.match(/^movie\/(\d+)(?:\/|$)/i);
  if (movieMatch) return { mediaType: 'movie', tmdbId: movieMatch[1] };

  const tvMatch = clean.match(/^tv\/(\d+)(?:\/|$)/i);
  if (tvMatch) return { mediaType: 'tv', tmdbId: tvMatch[1] };

  const findMatch = clean.match(/^find\/(tt\d+)(?:\/|$)/i);
  if (findMatch) return { imdbId: findMatch[1] };

  const prefixMatch = clean.match(/^(trending|discover|search)\/(movie|tv)(?:\/|$)/i);
  if (prefixMatch) {
    return { mediaType: prefixMatch[2].toLowerCase() === 'tv' ? 'tv' : 'movie' };
  }
  return {};
}

export function isTmdbItemBlocked(item: OptRecord, bl: IdBlocklist, kind?: MediaKind): boolean {
  if (!item || typeof item !== 'object') return false;
  const rawType = typeof item.media_type === 'string' ? item.media_type.toLowerCase() : '';
  const itemType: MediaKind | undefined =
    rawType === 'tv' || rawType === 'series' || rawType === 'show'
      ? 'tv'
      : rawType === 'movie'
        ? 'movie'
        : kind;

  const rawId = item.id;
  if (
    (typeof rawId === 'number' || typeof rawId === 'string') &&
    isTmdbBlocked(rawId, bl.tmdbIds, itemType)
  ) {
    return true;
  }

  const externalIds =
    item.external_ids && typeof item.external_ids === 'object'
      ? (item.external_ids as MediaRecord)
      : null;
  const imdbId =
    (typeof item.imdb_id === 'string' && item.imdb_id) ||
    (typeof externalIds?.imdb_id === 'string' && externalIds.imdb_id) ||
    null;

  return isImdbBlocked(imdbId, bl.imdbIds);
}

export function filterTmdbPayloadByTakedown<T>(p: T, bl: IdBlocklist, kind?: MediaKind): T | null {
  if (!p || typeof p !== 'object') return p;
  if (bl.tmdbIds.length === 0 && bl.imdbIds.length === 0) return p;

  const keepItem = (entry: unknown, fallbackKind?: MediaKind): boolean =>
    !isTmdbItemBlocked(entry as MediaRecord, bl, fallbackKind);

  const record = p as MediaRecord;
  if (Array.isArray(record.results)) {
    const filtered = record.results.filter(entry => keepItem(entry, kind));
    return { ...record, results: filtered } as T;
  }

  if (Array.isArray(record.movie_results) || Array.isArray(record.tv_results)) {
    const next: MediaRecord = { ...record };
    if (Array.isArray(record.movie_results)) {
      next.movie_results = record.movie_results.filter(entry => keepItem(entry, 'movie'));
    }
    if (Array.isArray(record.tv_results)) {
      next.tv_results = record.tv_results.filter(entry => keepItem(entry, 'tv'));
    }
    return next as T;
  }

  if ('id' in record && isTmdbItemBlocked(record, bl, kind)) {
    return null;
  }

  return p;
}

export function filterDiscoverPayloadByTakedown<T extends Discover>(p: T, bl: IdBlocklist): T {
  if (bl.tmdbIds.length === 0 && bl.imdbIds.length === 0) return p;
  const keepMovies = (items: MediaRecord[] = []): MediaRecord[] =>
    items.filter(item => !isTmdbItemBlocked(item, bl, 'movie'));
  const keepShows = (items: MediaRecord[] = []): MediaRecord[] =>
    items.filter(item => !isTmdbItemBlocked(item, bl, 'tv'));
  const filterSection = (section: DiscoverSection): DiscoverSection => ({
    movies: keepMovies(section.movies),
    shows: keepShows(section.shows),
  });

  const next: Discover = { ...p };
  if (p.popular) next.popular = filterSection(p.popular);
  if (p.topRated) next.topRated = filterSection(p.topRated);
  if (p.nowPlaying) next.nowPlaying = filterSection(p.nowPlaying);
  if (p.top10) next.top10 = filterSection(p.top10);
  if (p.latesttv) next.latesttv = { shows: keepShows(p.latesttv.shows) };
  return next as T;
}

export function filterEnrichmentFeedByTakedown<T extends Feed>(feed: T, ids: string[]): T {
  if (ids.length === 0) return feed;
  const movies = feed.movie_tmdb_ids.filter(id => !isTmdbBlocked(id, ids, 'movie'));
  const tvs = feed.tv_tmdb_ids.filter(id => !isTmdbBlocked(id, ids, 'tv'));
  return {
    ...feed,
    movie_tmdb_ids: movies,
    tv_tmdb_ids: tvs,
    count: new Set([...movies, ...tvs]).size,
  };
}

export function filterCuratedListsByTakedown<T extends Curated>(lists: T[], ids: string[]): T[] {
  if (ids.length === 0) return lists;
  return lists
    .map(list => {
      const tmdbIds = list.tmdbIds.filter(id => !isTmdbBlocked(id, ids, 'movie'));
      return { ...list, tmdbIds, count: tmdbIds.length };
    })
    .filter(list => list.tmdbIds.length > 0);
}

export function filterBlockedAddons<T>(addons: T[], blockedDomains: string[]): AddonResult<T> {
  if (!Array.isArray(addons) || blockedDomains.length === 0) {
    return { addons: Array.isArray(addons) ? addons : [], removedCount: 0 };
  }

  const kept: T[] = [];
  let removedCount = 0;

  for (const addon of addons) {
    let blocked = false;
    if (typeof addon === 'string') {
      blocked = isDomainBlocked(addon, blockedDomains);
    } else if (addon && typeof addon === 'object') {
      const record = addon as Record<string, unknown>;
      const urls = [
        record.url,
        record.manifestUrl,
        record.transportUrl,
        record.baseUrl,
        record.host,
      ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
      blocked = urls.some(url => isDomainBlocked(url, blockedDomains));
    }

    if (blocked) {
      removedCount += 1;
    } else {
      kept.push(addon);
    }
  }

  return { addons: kept, removedCount };
}
