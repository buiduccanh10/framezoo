import { mobileStorage } from '../storage/storage';
import { useAuthStore } from '@/state/auth/store';

export interface ComplianceBlocklist {
  addonDomains: string[];
  tmdbIds: string[];
  imdbIds: string[];
  subtitleIds: string[];
  infohashes: string[];
  updatedAt?: string;
}

const CACHE_KEY = '@framezoo/mobile/compliance-blocklist';
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

export async function fetchComplianceBlocklist(
  force = false,
): Promise<ComplianceBlocklist> {
  const now = Date.now();
  if (!force && memoryCache && memoryCache.expiresAt > now) {
    return memoryCache.data;
  }

  const backendUrl = useAuthStore.getState().backendUrl?.trim().replace(/\/+$/, '');
  if (!backendUrl) {
    return (await mobileStorage.getJson<ComplianceBlocklist>(CACHE_KEY)) ?? emptyBlocklist();
  }

  try {
    const response = await fetch(`${backendUrl}/compliance/blocklist`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = (await response.json()) as Partial<ComplianceBlocklist>;
    const normalized: ComplianceBlocklist = {
      addonDomains: Array.isArray(payload.addonDomains) ? payload.addonDomains : [],
      tmdbIds: Array.isArray(payload.tmdbIds) ? payload.tmdbIds : [],
      imdbIds: Array.isArray(payload.imdbIds) ? payload.imdbIds : [],
      subtitleIds: Array.isArray(payload.subtitleIds) ? payload.subtitleIds : [],
      infohashes: Array.isArray(payload.infohashes) ? payload.infohashes : [],
      updatedAt: payload.updatedAt,
    };
    memoryCache = { expiresAt: now + CACHE_TTL_MS, data: normalized };
    await mobileStorage.setJson(CACHE_KEY, normalized).catch(() => undefined);
    return normalized;
  } catch {
    return (
      memoryCache?.data ??
      (await mobileStorage.getJson<ComplianceBlocklist>(CACHE_KEY)) ??
      emptyBlocklist()
    );
  }
}

export * from './blocklistMatchers';
