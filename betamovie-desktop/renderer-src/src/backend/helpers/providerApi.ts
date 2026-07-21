import { jwtDecode } from "jwt-decode";

import { PROVIDER_METADATA_CACHE_UPDATED_EVENT } from "@/backend/providers/metadataEvents";
import { getProviders } from "@/backend/providers/providers";
import { MetaOutput } from "@/lib/providers";

let metaDataCache: MetaOutput[] | null = null;
let token: null | string = null;

function sortMetadata(data: MetaOutput[]): MetaOutput[] {
  return [...data].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "source" ? -1 : 1;
    }

    const rankDiff = (left.rank ?? 0) - (right.rank ?? 0);
    if (rankDiff !== 0) return rankDiff;

    return left.name.localeCompare(right.name);
  });
}

export function setCachedMetadata(data: MetaOutput[]) {
  metaDataCache = sortMetadata(data);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROVIDER_METADATA_CACHE_UPDATED_EVENT));
  }
}

export function getCachedMetadata(): MetaOutput[] {
  return metaDataCache ?? [];
}

export function refreshCachedMetadata() {
  const providers = getProviders();
  setCachedMetadata([...providers.listSources(), ...providers.listEmbeds()]);
}

export function setApiToken(newToken: string) {
  token = newToken;
}

function getTokenIfValid(): null | string {
  if (!token) return null;
  try {
    const body = jwtDecode(token);
    if (!body.exp) return `jwt|${token}`;
    if (Date.now() / 1000 < body.exp) return `jwt|${token}`;
  } catch {
    // we dont care about parse errors
  }
  return null;
}

export async function getApiToken(): Promise<string | null> {
  return getTokenIfValid();
}
