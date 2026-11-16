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
  const bare = tmdbId.trim().toLowerCase();
  const normalizedType =
    mediaType.toLowerCase() === "show" ? "tv" : mediaType.toLowerCase();
  const candidates = new Set([
    bare,
    `movie:${bare}`,
    `tv:${bare}`,
    `series:${bare}`,
  ]);
  if (normalizedType) {
    candidates.add(`${normalizedType}:${bare}`);
  }
  return blockedTmdbIds.some((entry) =>
    candidates.has(entry.trim().toLowerCase()),
  );
}
