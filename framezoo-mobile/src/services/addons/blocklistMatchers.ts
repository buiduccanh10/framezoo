export function extractAddonHostname(rawUrl: string): string | null {
  try {
    const normalized = rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`;
    return new URL(normalized).hostname.toLowerCase().replace(/\.+$/, '') || null;
  } catch {
    return null;
  }
}

export function isAddonDomainBlocked(
  urlOrHost: string,
  blockedDomains: string[],
): boolean {
  if (!urlOrHost || blockedDomains.length === 0) return false;
  const host = extractAddonHostname(urlOrHost);
  if (!host) return false;
  return blockedDomains.some((entry) => {
    const domain = entry.trim().toLowerCase().replace(/^\*\./, '');
    return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
  });
}

export function isMediaIdBlocked(
  mediaId: string | null | undefined,
  mediaType: string,
  blocklist: { tmdbIds: string[]; imdbIds: string[] },
): boolean {
  if (!mediaId) return false;
  const clean = mediaId.trim().toLowerCase();
  if (!clean) return false;
  const baseId = clean.split(':')[0] || clean;

  if (/^tt\d+$/.test(baseId)) {
    return blocklist.imdbIds.some((entry) => entry.trim().toLowerCase() === baseId);
  }

  const bareTmdb = baseId.startsWith('tmdb:')
    ? baseId.slice('tmdb:'.length)
    : clean.startsWith('tmdb:')
      ? clean.slice('tmdb:'.length).split(':')[0]
      : /^\d+$/.test(baseId)
        ? baseId
        : '';
  if (!bareTmdb || blocklist.tmdbIds.length === 0) return false;

  const normalizedType =
    mediaType.toLowerCase() === 'show' || mediaType.toLowerCase() === 'series'
      ? 'tv'
      : mediaType.toLowerCase();
  const candidates = new Set([bareTmdb]);
  if (normalizedType) {
    candidates.add(`${normalizedType}:${bareTmdb}`);
    if (normalizedType === 'tv') candidates.add(`series:${bareTmdb}`);
  } else {
    candidates.add(`movie:${bareTmdb}`);
    candidates.add(`tv:${bareTmdb}`);
    candidates.add(`series:${bareTmdb}`);
  }
  return blocklist.tmdbIds.some((entry) => candidates.has(entry.trim().toLowerCase()));
}

export function isInfohashBlocked(
  infoHash: string | null | undefined,
  url: string | null | undefined,
  blockedInfohashes: string[],
): boolean {
  if (blockedInfohashes.length === 0) return false;
  const direct = infoHash?.trim().replace(/^urn:btih:/i, '').toLowerCase() || null;
  const fromUrl = url?.match(/btih:([0-9a-f]{40}|[a-z2-7]{32})/i)?.[1]?.toLowerCase() || null;
  const hash = direct || fromUrl;
  if (!hash) return false;
  return blockedInfohashes.some((entry) => entry.trim().toLowerCase() === hash);
}

export function isSubtitleIdBlocked(
  subtitleId: string | null | undefined,
  blockedSubtitleIds: string[],
): boolean {
  if (!subtitleId || blockedSubtitleIds.length === 0) return false;
  const normalized = subtitleId.trim().toLowerCase();
  if (!normalized) return false;

  const segments = normalized.split(':');
  const inputProvider = segments.length >= 2 ? segments[0] : null;
  const bareNumericId =
    inputProvider === 'wyzie' && segments.length >= 3 && segments[2]
      ? segments[2]
      : segments.length >= 2
        ? segments[1]
        : normalized;

  return blockedSubtitleIds.some((entry) => {
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
