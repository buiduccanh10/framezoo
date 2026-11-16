import { conf } from "@/setup/config";
import { useAuthStore } from "@/stores/auth";

export interface ComplianceBlocklist {
  addonDomains: string[];
  tmdbIds: string[];
  imdbIds: string[];
  subtitleIds: string[];
  infohashes: string[];
  updatedAt?: string;
}

const CACHE_KEY = "framezoo.compliance.blocklist.v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

let memoryCache: { expiresAt: number; data: ComplianceBlocklist } | null = null;

export function clearComplianceBlocklistCache(): void {
  memoryCache = null;
}

function emptyBlocklist(): ComplianceBlocklist {
  return {
    addonDomains: [],
    tmdbIds: [],
    imdbIds: [],
    subtitleIds: [],
    infohashes: [],
  };
}

function readStoredBlocklist(): ComplianceBlocklist | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ComplianceBlocklist>;
    return {
      addonDomains: Array.isArray(parsed.addonDomains)
        ? parsed.addonDomains
        : [],
      tmdbIds: Array.isArray(parsed.tmdbIds) ? parsed.tmdbIds : [],
      imdbIds: Array.isArray(parsed.imdbIds) ? parsed.imdbIds : [],
      subtitleIds: Array.isArray(parsed.subtitleIds) ? parsed.subtitleIds : [],
      infohashes: Array.isArray(parsed.infohashes) ? parsed.infohashes : [],
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export function resolveComplianceBackendUrl(): string | null {
  const authBackend = useAuthStore.getState().backendUrl;
  const config = conf();
  const base =
    authBackend ||
    config.BACKEND_URL ||
    (config.BACKEND_URLS.length > 0 ? config.BACKEND_URLS[0] : null) ||
    config.APP_DOMAIN ||
    "https://framezoo.top";
  return base ? base.replace(/\/+$/, "") : null;
}

export async function fetchComplianceBlocklist(
  force = false,
): Promise<ComplianceBlocklist> {
  const now = Date.now();
  if (!force && memoryCache && memoryCache.expiresAt > now) {
    return memoryCache.data;
  }

  const baseUrl = resolveComplianceBackendUrl();
  if (!baseUrl) {
    return readStoredBlocklist() ?? emptyBlocklist();
  }

  try {
    const res = await fetch(`${baseUrl}/compliance/blocklist`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const payload = (await res.json()) as Partial<ComplianceBlocklist>;
    const normalized: ComplianceBlocklist = {
      addonDomains: Array.isArray(payload.addonDomains)
        ? payload.addonDomains
        : [],
      tmdbIds: Array.isArray(payload.tmdbIds) ? payload.tmdbIds : [],
      imdbIds: Array.isArray(payload.imdbIds) ? payload.imdbIds : [],
      subtitleIds: Array.isArray(payload.subtitleIds)
        ? payload.subtitleIds
        : [],
      infohashes: Array.isArray(payload.infohashes) ? payload.infohashes : [],
      updatedAt: payload.updatedAt,
    };
    memoryCache = { expiresAt: now + CACHE_TTL_MS, data: normalized };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(normalized));
    } catch {
      // Ignore storage quota issues.
    }
    return normalized;
  } catch {
    return memoryCache?.data ?? readStoredBlocklist() ?? emptyBlocklist();
  }
}

export function extractHostname(rawUrl: string): string | null {
  try {
    const withScheme = rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`;
    return (
      new URL(withScheme).hostname.toLowerCase().replace(/\.+$/, "") || null
    );
  } catch {
    return null;
  }
}

export function isDomainInBlocklist(
  urlOrHost: string,
  blockedDomains: string[],
): boolean {
  if (!urlOrHost || blockedDomains.length === 0) return false;
  const host = extractHostname(urlOrHost);
  if (!host) return false;
  return blockedDomains.some((entry) => {
    const domain = entry.trim().toLowerCase().replace(/^\*\./, "");
    return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
  });
}

export function isMediaBlocked(
  tmdbId: string,
  mediaType: string,
  blockedTmdbIds: string[],
): boolean {
  if (!tmdbId || blockedTmdbIds.length === 0) return false;
  const bare = tmdbId
    .trim()
    .toLowerCase()
    .replace(/^(movie|tv|series|tmdb):/, "");
  if (!bare) return false;
  const normalizedType =
    mediaType.toLowerCase() === "show" || mediaType.toLowerCase() === "series"
      ? "tv"
      : mediaType.toLowerCase();
  const candidates = new Set([
    bare,
    normalizedType ? `${normalizedType}:${bare}` : bare,
  ]);
  if (normalizedType === "tv") {
    candidates.add(`series:${bare}`);
  } else if (!normalizedType) {
    candidates.add(`movie:${bare}`);
    candidates.add(`tv:${bare}`);
    candidates.add(`series:${bare}`);
  }
  return blockedTmdbIds.some((entry) =>
    candidates.has(entry.trim().toLowerCase()),
  );
}

export function isImdbBlocked(
  imdbId: string | null | undefined,
  blockedImdbIds: string[],
): boolean {
  if (!imdbId || blockedImdbIds.length === 0) return false;
  const clean = imdbId.trim().toLowerCase().split(":")[0];
  if (!clean) return false;
  return blockedImdbIds.some((entry) => entry.trim().toLowerCase() === clean);
}

export function extractInfohashFromStreamOrUrl(
  infoHash?: string | null,
  url?: string | null,
): string | null {
  if (infoHash) {
    const clean = infoHash
      .trim()
      .replace(/^urn:btih:/i, "")
      .toLowerCase();
    if (clean) return clean;
  }
  if (url) {
    const match = url.match(/btih:([0-9a-f]{40}|[a-z2-7]{32})/i);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

export function isInfohashBlocked(
  infoHashOrUrl: string | null | undefined,
  blockedInfohashes: string[],
  url?: string | null,
): boolean {
  if (blockedInfohashes.length === 0) return false;
  const hash = extractInfohashFromStreamOrUrl(
    infoHashOrUrl,
    url ?? infoHashOrUrl,
  );
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

  const segments = normalized.split(":");
  const inputProvider = segments.length >= 2 ? segments[0] : null;
  const bareNumericId =
    inputProvider === "wyzie" && segments.length >= 3 && segments[2]
      ? segments[2]
      : segments.length >= 2
        ? segments[1]
        : normalized;

  return blockedSubtitleIds.some((entry) => {
    const pattern = entry.trim().toLowerCase();
    if (!pattern) return false;
    if (pattern === normalized) return true;
    if (bareNumericId && pattern === bareNumericId) return true;
    if (/^https?:\/\//.test(pattern) && normalized.endsWith(`:${pattern}`)) {
      return true;
    }

    const entrySegments = pattern.split(":");
    const entryProvider = entrySegments.length >= 2 ? entrySegments[0] : null;
    if (entryProvider && inputProvider && entryProvider === inputProvider) {
      if (
        normalized.startsWith(`${pattern}:`) ||
        pattern.startsWith(`${normalized}:`)
      ) {
        return true;
      }
    }
    return pattern === `subsource:${bareNumericId}`;
  });
}

export function isAddonMediaBlocked(
  mediaId: string | null | undefined,
  mediaType: string,
  blocklist: Pick<ComplianceBlocklist, "tmdbIds" | "imdbIds">,
): boolean {
  if (!mediaId) return false;
  const clean = mediaId.trim();
  if (!clean) return false;
  const baseId = clean.split(":")[0] || clean;
  if (/^tt\d+$/i.test(baseId)) {
    return isImdbBlocked(baseId, blocklist.imdbIds);
  }
  const tmdbValue = clean.toLowerCase().startsWith("tmdb:")
    ? clean.slice(5).split(":")[0]
    : /^\d+$/.test(baseId)
      ? baseId
      : "";
  if (tmdbValue) {
    return isMediaBlocked(tmdbValue, mediaType, blocklist.tmdbIds);
  }
  return false;
}
