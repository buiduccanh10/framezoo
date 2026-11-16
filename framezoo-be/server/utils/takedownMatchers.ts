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

export function isDomainBlocked(urlOrHost: string | null | undefined, blockedDomains: string[]): boolean {
  if (!urlOrHost || blockedDomains.length === 0) return false;
  const host = extractDomainHost(urlOrHost);
  if (!host) return false;

  return blockedDomains.some(pattern => {
    const normalized = pattern.trim().toLowerCase().replace(/^\*\./, '');
    if (!normalized) return false;
    return host === normalized || host.endsWith(`.${normalized}`);
  });
}

export function isTmdbBlocked(
  tmdbId: string | number | null | undefined,
  blockedTmdbIds: string[],
  mediaType?: 'movie' | 'tv' | 'series'
): boolean {
  if (tmdbId == null || blockedTmdbIds.length === 0) return false;
  const raw = String(tmdbId).trim().toLowerCase();
  if (!raw) return false;

  const bareId = raw.replace(/^(movie|tv|series):/, '');
  const candidates = new Set([raw, bareId]);
  if (mediaType) {
    candidates.add(`${mediaType}:${bareId}`);
    if (mediaType === 'series') candidates.add(`tv:${bareId}`);
    if (mediaType === 'tv') candidates.add(`series:${bareId}`);
  } else {
    candidates.add(`movie:${bareId}`);
    candidates.add(`tv:${bareId}`);
    candidates.add(`series:${bareId}`);
  }

  return blockedTmdbIds.some(entry => candidates.has(entry.trim().toLowerCase()));
}

export function isImdbBlocked(imdbId: string | null | undefined, blockedImdbIds: string[]): boolean {
  if (!imdbId || blockedImdbIds.length === 0) return false;
  const clean = imdbId.trim().toLowerCase().split(':')[0];
  if (!clean) return false;

  return blockedImdbIds.some(entry => entry.trim().toLowerCase() === clean);
}

export function isSubtitleIdBlocked(
  subtitleId: string | null | undefined,
  blockedSubtitleIds: string[]
): boolean {
  if (!subtitleId || blockedSubtitleIds.length === 0) return false;
  const normalized = subtitleId.trim().toLowerCase();
  if (!normalized) return false;

  // Match either exact composite id (`subsource:123:vi`), URL substring, or numeric provider id (`123`).
  const segments = normalized.split(':');
  const bareNumericId = segments.length >= 2 ? segments[1] : normalized;

  return blockedSubtitleIds.some(entry => {
    const pattern = entry.trim().toLowerCase();
    if (!pattern) return false;
    if (pattern === normalized || pattern === bareNumericId) return true;
    return pattern === `subsource:${bareNumericId}`;
  });
}

export function filterBlockedAddons<T>(
  addons: T[],
  blockedDomains: string[]
): { addons: T[]; removedCount: number } {
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
