export type GuestWindow = '6h' | '24h' | '7d' | '30d';

export type GuestPlatformFilter = 'all' | 'Desktop' | 'Mobile' | 'TV';

export const GUEST_WINDOW_HOURS: Record<GuestWindow, number> = {
  '6h': 6,
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

export const GUEST_THROTTLE_MS = 60_000;
export const GUEST_CACHE_MAX_ENTRIES = 10_000;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GuestActivityCacheEntry {
  flushedAt: number;
  appVersion: string | null;
  platform: string;
  pendingHits: number;
}

export function normalizeGuestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!UUID_REGEX.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function parseGuestWindow(value: unknown): GuestWindow {
  if (value === '6h' || value === '24h' || value === '7d' || value === '30d') {
    return value;
  }
  return '24h';
}

export function parseGuestPlatformFilter(value: unknown): GuestPlatformFilter {
  if (value === 'Desktop' || value === 'Mobile' || value === 'TV') {
    return value;
  }
  return 'all';
}

export function getGuestWindowStart(window: GuestWindow, now = new Date()): Date {
  return new Date(now.getTime() - GUEST_WINDOW_HOURS[window] * 60 * 60 * 1000);
}

export const isAppGuestPlatform = (
  platform: string | null | undefined,
  appVersion?: string | null
): boolean => {
  if (typeof appVersion === 'string' && appVersion.trim().length > 0) return true;
  if (typeof platform !== 'string') return false;
  return (
    platform.endsWith(' · Desktop') || platform.endsWith(' · Mobile') || platform.endsWith(' · TV')
  );
};

export const summarizeClientPlatform = (userAgent: string, appVersion?: string | null): string => {
  const ua = userAgent.toLowerCase();
  const hasAppVersion = Boolean(appVersion && appVersion.trim());
  if (!ua && !hasAppVersion) return 'Không rõ thiết bị';

  let os = 'Khác';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) os = 'iOS';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('mac os') || ua.includes('macintosh')) os = 'macOS';
  else if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('linux')) os = 'Linux';

  let client = 'Web';
  if (ua.includes('electron') || ua.includes('framezoo-desktop')) client = 'Desktop';
  else if (ua.includes('expo') || ua.includes('reactnative') || ua.includes('framezoo-mobile')) {
    client = 'Mobile';
  } else if (
    ua.includes('tv') ||
    ua.includes('tizen') ||
    ua.includes('webos') ||
    ua.includes('framezoo-tv')
  ) {
    client = 'TV';
  } else if (ua.includes('framezoo/') || hasAppVersion) {
    client = 'Desktop';
  }

  return `${os} · ${client}`;
};

/**
 * Coalesce burst guest API calls in memory so page-load TMDB/addon fan-outs do
 * not write a DB row per request while still flushing app version changes immediately.
 */
export function reserveGuestActivityFlush(
  cache: Map<string, GuestActivityCacheEntry>,
  input: {
    guestId: string;
    appVersion: string | null;
    platform: string;
    bypassThrottle?: boolean;
  },
  nowMs = Date.now()
): { shouldFlush: boolean; hitIncrement: number } {
  const existing = cache.get(input.guestId);
  const versionChanged = Boolean(input.appVersion && input.appVersion !== existing?.appVersion);
  const platformChanged = Boolean(
    input.platform &&
    input.platform !== 'Không rõ thiết bị' &&
    input.platform !== existing?.platform
  );

  if (
    !input.bypassThrottle &&
    existing &&
    nowMs - existing.flushedAt < GUEST_THROTTLE_MS &&
    !versionChanged &&
    !platformChanged
  ) {
    existing.pendingHits += 1;
    return { shouldFlush: false, hitIncrement: 0 };
  }

  const hitIncrement = 1 + (existing?.pendingHits ?? 0);

  if (!existing && cache.size >= GUEST_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }

  cache.set(input.guestId, {
    flushedAt: nowMs,
    appVersion: input.appVersion ?? existing?.appVersion ?? null,
    platform:
      input.platform && input.platform !== 'Không rõ thiết bị'
        ? input.platform
        : (existing?.platform ?? input.platform),
    pendingHits: 0,
  });

  return { shouldFlush: true, hitIncrement };
}
