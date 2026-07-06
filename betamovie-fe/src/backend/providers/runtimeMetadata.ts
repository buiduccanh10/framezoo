import { useEffect, useState } from "react";

import { PROVIDER_METADATA_CACHE_UPDATED_EVENT } from "@/backend/providers/metadataEvents";
import type { MetaOutput } from "@/lib/providers";
import { conf } from "@/setup/config";
import { useAuthStore } from "@/stores/auth";
import { getBackendAuthHeaders } from "@/utils/backendAuth";

export type ProviderMetadataOverride = {
  id: string;
  type?: MetaOutput["type"];
  name?: string;
  rank?: number;
  disabled?: boolean;
};

type ProviderMetadataResponse = {
  providers?: ProviderMetadataOverride[];
};

let providerMetadataVersion = 0;
let providerMetadataLoadPromise: Promise<void> | null = null;
let providerMetadataLoaded = false;
let providerMetadataKey = "";
let providerMetadataById = new Map<string, ProviderMetadataOverride>();

const subscribers = new Set<() => void>();

function isDesktopAppRuntime() {
  return (
    typeof window !== "undefined" &&
    Boolean((window as any).__ALPHAFLIX_DESKTOP__)
  );
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function getBackendCandidates(): string[] {
  const config = conf();
  const configuredUrls =
    config.BACKEND_URLS.length > 0
      ? config.BACKEND_URLS
      : config.BACKEND_URL
        ? [config.BACKEND_URL]
        : [];

  if (isDesktopAppRuntime()) {
    return Array.from(new Set(configuredUrls.map(normalizeUrl)));
  }

  const userBackendUrl = useAuthStore.getState().backendUrl;
  const urls = [
    userBackendUrl ? normalizeUrl(userBackendUrl) : null,
    ...configuredUrls.map(normalizeUrl),
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(urls));
}

function notifyProviderMetadataChange() {
  providerMetadataVersion += 1;
  subscribers.forEach((subscriber) => subscriber());
}

function normalizeProviderMetadata(
  payload: ProviderMetadataResponse["providers"],
): ProviderMetadataOverride[] {
  if (!Array.isArray(payload)) return [];

  return payload
    .filter((item): item is ProviderMetadataOverride => Boolean(item?.id))
    .map((item) => ({
      id: item.id,
      type: item.type,
      name: typeof item.name === "string" ? item.name : undefined,
      rank:
        typeof item.rank === "number" && Number.isFinite(item.rank)
          ? item.rank
          : undefined,
      disabled: typeof item.disabled === "boolean" ? item.disabled : undefined,
    }));
}

function setProviderMetadata(items: ProviderMetadataOverride[]) {
  const next = new Map(items.map((item) => [item.id, item]));
  const nextSignature = JSON.stringify(
    [...next.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
  const currentSignature = JSON.stringify(
    [...providerMetadataById.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );

  if (nextSignature === currentSignature) return;

  providerMetadataById = next;
  notifyProviderMetadataChange();
}

async function fetchProviderMetadataFrom(
  backendUrl: string,
): Promise<ProviderMetadataOverride[]> {
  const response = await fetch(`${backendUrl}/api/providers`, {
    credentials: "include",
    headers: getBackendAuthHeaders(`${backendUrl}/api/providers`),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch provider metadata: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as ProviderMetadataResponse;
  return normalizeProviderMetadata(payload.providers);
}

export async function loadProviderMetadata(force = false): Promise<void> {
  const backendCandidates = getBackendCandidates();
  const nextKey = backendCandidates.join(",");

  if (!force && providerMetadataLoadPromise) {
    return providerMetadataLoadPromise;
  }

  if (!force && providerMetadataLoaded && providerMetadataKey === nextKey) {
    return;
  }

  providerMetadataLoadPromise = (async () => {
    providerMetadataKey = nextKey;

    if (backendCandidates.length === 0) {
      setProviderMetadata([]);
      providerMetadataLoaded = true;
      return;
    }

    let lastError: unknown = null;
    for (const backendUrl of backendCandidates) {
      try {
        const metadata = await fetchProviderMetadataFrom(backendUrl);
        setProviderMetadata(metadata);
        providerMetadataLoaded = true;
        return;
      } catch (error) {
        lastError = error;
      }
    }

    setProviderMetadata([]);
    providerMetadataLoaded = false;
    if (lastError) {
      console.warn(
        "[ProviderMetadata] Failed to load remote metadata",
        lastError,
      );
    }
  })().finally(() => {
    providerMetadataLoadPromise = null;
  });

  return providerMetadataLoadPromise;
}

export function applyProviderMetadataOverride<
  T extends {
    id: string;
    type?: MetaOutput["type"];
    name: string;
    rank?: number;
    disabled?: boolean;
  },
>(provider: T): T {
  const override = providerMetadataById.get(provider.id);

  if (!override) return provider;
  if (override.type && provider.type && override.type !== provider.type) {
    return provider;
  }

  return {
    ...provider,
    name: override.name ?? provider.name,
    rank: override.rank ?? provider.rank,
    disabled: override.disabled ?? provider.disabled,
  };
}

export function subscribeProviderMetadata(listener: () => void) {
  subscribers.add(listener);

  return () => {
    subscribers.delete(listener);
  };
}

export function useProviderMetadataVersion(): number {
  const [version, setVersion] = useState(providerMetadataVersion);

  useEffect(() => {
    const unsubscribe = subscribeProviderMetadata(() =>
      setVersion(providerMetadataVersion),
    );
    const handleCacheUpdate = () => {
      setVersion((currentVersion) => currentVersion + 1);
    };

    window.addEventListener(
      PROVIDER_METADATA_CACHE_UPDATED_EVENT,
      handleCacheUpdate,
    );

    return () => {
      unsubscribe();
      window.removeEventListener(
        PROVIDER_METADATA_CACHE_UPDATED_EVENT,
        handleCacheUpdate,
      );
    };
  }, []);

  return version;
}
