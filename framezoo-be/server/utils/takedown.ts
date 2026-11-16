import { prisma } from '~/utils/prisma';
import {
  filterBlockedAddons,
  groupTakedownRules,
  isDomainBlocked,
  isImdbBlocked,
  isSubtitleIdBlocked,
  isTmdbBlocked,
  type TakedownBlocklist,
} from './takedownMatchers';

export * from './takedownMatchers';

// shortcut: process-local 60s cache keeps blocklist checks cheap without Redis invalidation plumbing; move to Redis pub/sub for multi-replica instant propagation.
const TAKEDOWN_CACHE_TTL_MS = 60_000;

let cachedBlocklist: { expiresAt: number; value: TakedownBlocklist } | null = null;

export function invalidateTakedownCache(): void {
  cachedBlocklist = null;
}

export async function getActiveTakedownBlocklist(): Promise<TakedownBlocklist> {
  const now = Date.now();
  if (cachedBlocklist && cachedBlocklist.expiresAt > now) {
    return cachedBlocklist.value;
  }

  const rules = await prisma.takedown_rules.findMany({
    where: { active: true },
    select: { target_type: true, pattern: true },
  });

  const blocklist = groupTakedownRules(rules);
  cachedBlocklist = {
    expiresAt: now + TAKEDOWN_CACHE_TTL_MS,
    value: blocklist,
  };

  return blocklist;
}

export async function filterBlockedAddonsForUser<T>(
  addons: T[]
): Promise<{ addons: T[]; removedCount: number }> {
  const blocklist = await getActiveTakedownBlocklist();
  return filterBlockedAddons(addons, blocklist.addonDomains);
}

export async function checkAddonUrlBlocked(url: string): Promise<boolean> {
  const blocklist = await getActiveTakedownBlocklist();
  return isDomainBlocked(url, blocklist.addonDomains);
}

export async function checkSubtitleTargetBlocked(params: {
  tmdbId?: string | number | null;
  imdbId?: string | null;
  subtitleId?: string | null;
  mediaType?: 'movie' | 'tv' | 'series';
}): Promise<boolean> {
  const blocklist = await getActiveTakedownBlocklist();
  if (params.tmdbId != null && isTmdbBlocked(params.tmdbId, blocklist.tmdbIds, params.mediaType)) {
    return true;
  }
  if (params.imdbId && isImdbBlocked(params.imdbId, blocklist.imdbIds)) {
    return true;
  }
  if (params.subtitleId && isSubtitleIdBlocked(params.subtitleId, blocklist.subtitleIds)) {
    return true;
  }
  return false;
}
