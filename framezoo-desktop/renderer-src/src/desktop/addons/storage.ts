import { updateSettings } from "@/backend/accounts/settings";
import { conf } from "@/setup/config";
import { useAuthStore } from "@/stores/auth";
import { queryClient } from "@/utils/queryClient";

import type { InstalledAddon } from "./types";

const STORAGE_KEY = "framezoo.desktop.addons.v1";
export const NATIVE_SUBTITLE_ADDON_ID = "community.framezoo.subtitles";

export function getNativeSubtitlesAddon(): InstalledAddon {
  const config = conf();
  const rawBackendUrl =
    config.BACKEND_URL ||
    (config.BACKEND_URLS.length > 0 ? config.BACKEND_URLS[0] : "") ||
    "";
  const backendBase = rawBackendUrl ? rawBackendUrl.replace(/\/+$/, "") : "";
  const isLocalBackend =
    backendBase.includes("localhost") || backendBase.includes("127.0.0.1");
  const appDomain = (config.APP_DOMAIN || "https://framezoo.top")
    .trim()
    .replace(/\/+$/, "");
  // In production / non-local setups, route addon traffic via appDomain (framezoo.top/addon/...)
  // to avoid exposing the direct backend API endpoint.
  const base = isLocalBackend ? backendBase : appDomain || backendBase;
  const manifestUrl = base
    ? `${base}/addon/subtitles/manifest.json`
    : "/addon/subtitles/manifest.json";
  const baseUrl = base ? `${base}/addon/subtitles/` : "/addon/subtitles/";

  return {
    manifestUrl,
    baseUrl,
    manifest: {
      id: NATIVE_SUBTITLE_ADDON_ID,
      version: "1.0.0",
      name: "Framezoo Subtitles",
      description:
        "Native subtitle provider (Wyzie, OpenSubtitles, SubSource, Granite)",
      resources: ["subtitles"],
      types: ["movie", "series"],
      catalogs: [],
      behaviorHints: {
        configurable: false,
      },
    },
    enabled: true,
    addedAt: 0,
    isNative: true,
  };
}

export function getCustomAddons(
  addonsList: InstalledAddon[] = addons,
): InstalledAddon[] {
  return addonsList.filter(
    (item) => item.manifest.id !== NATIVE_SUBTITLE_ADDON_ID && !item.isNative,
  );
}

export function getActiveBackendUrl(): string | null {
  const backendUrl = useAuthStore.getState().backendUrl;
  const config = conf();
  const configuredBackend =
    config.BACKEND_URL ??
    (config.BACKEND_URLS.length > 0 ? config.BACKEND_URLS[0] : null);

  if (
    typeof window !== "undefined" &&
    Boolean((window as any).__FRAMEZOO_DESKTOP__) &&
    configuredBackend
  ) {
    return configuredBackend;
  }

  return backendUrl ?? configuredBackend;
}

let syncTimeout: ReturnType<typeof setTimeout> | null = null;

export function syncAddonsToBackend() {
  const account = useAuthStore.getState().account;
  const backendUrl = getActiveBackendUrl();
  if (!account || !backendUrl) return;

  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    try {
      const customAddons = getCustomAddons();
      await updateSettings(backendUrl, account, {
        addons: customAddons,
      });
    } catch (err) {
      console.error("[addons] Failed to sync addons to backend:", err);
    }
  }, 300);
}

export function mergeAddonLists(
  localAddons: InstalledAddon[],
  remoteAddons: InstalledAddon[],
): InstalledAddon[] {
  const map = new Map<string, InstalledAddon>();

  for (const addon of remoteAddons) {
    if (addon.manifest.id === NATIVE_SUBTITLE_ADDON_ID || addon.isNative) {
      continue;
    }
    const key = addon.manifest.id || addon.manifestUrl;
    map.set(key, addon);
  }

  for (const addon of localAddons) {
    if (addon.manifest.id === NATIVE_SUBTITLE_ADDON_ID || addon.isNative) {
      continue;
    }
    const key = addon.manifest.id || addon.manifestUrl;
    if (!map.has(key)) {
      map.set(key, addon);
    } else {
      const existing = map.get(key)!;
      if (addon.addedAt > existing.addedAt) {
        map.set(key, addon);
      }
    }
  }

  return Array.from(map.values());
}

function mergeWithNativeAddons(userAddons: InstalledAddon[]): InstalledAddon[] {
  const nativeAddon = getNativeSubtitlesAddon();
  const existingNative = userAddons.find(
    (item) => item.manifest.id === NATIVE_SUBTITLE_ADDON_ID || item.isNative,
  );

  const enabled =
    existingNative != null ? existingNative.enabled : nativeAddon.enabled;
  const currentNative: InstalledAddon = {
    ...nativeAddon,
    enabled,
  };

  const filteredUserAddons = userAddons.filter(
    (item) => item.manifest.id !== NATIVE_SUBTITLE_ADDON_ID && !item.isNative,
  );

  return [currentNative, ...filteredUserAddons];
}

function readAddons(): InstalledAddon[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    const rawAddons = Array.isArray(value) ? (value as InstalledAddon[]) : [];
    return mergeWithNativeAddons(rawAddons);
  } catch {
    return mergeWithNativeAddons([]);
  }
}

let addons: InstalledAddon[] = readAddons();
const listeners = new Set<() => void>();

export function invalidateExternalSubtitlesCache() {
  try {
    queryClient.removeQueries({ queryKey: ["externalSubtitles"] });
  } catch (err) {
    console.warn(
      "[addons] Failed to invalidate external subtitles cache:",
      err,
    );
  }
}

function publish(syncToBackend = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(addons));
  } catch (err) {
    console.warn("[addons] Failed to write to localStorage:", err);
  }
  invalidateExternalSubtitlesCache();
  for (const listener of listeners) listener();
  if (syncToBackend) {
    syncAddonsToBackend();
  }
}

export function getInstalledAddons(): InstalledAddon[] {
  return addons;
}

export function subscribeInstalledAddons(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function upsertAddon(addon: InstalledAddon) {
  if (addon.manifest.id === NATIVE_SUBTITLE_ADDON_ID || addon.isNative) {
    addons = addons.map((item) =>
      item.manifest.id === NATIVE_SUBTITLE_ADDON_ID || item.isNative
        ? { ...item, ...addon, isNative: true }
        : item,
    );
  } else {
    addons = [
      ...addons.filter((item) => item.manifest.id !== addon.manifest.id),
      addon,
    ];
  }
  publish(true);
}

export function removeAddon(id: string) {
  if (id === NATIVE_SUBTITLE_ADDON_ID) return;
  const target = addons.find((item) => item.manifest.id === id);
  if (target?.isNative) return;

  addons = addons.filter((item) => item.manifest.id !== id);
  publish(true);
}

export function setAddonEnabled(id: string, enabled: boolean) {
  addons = addons.map((item) =>
    item.manifest.id === id ||
    (id === NATIVE_SUBTITLE_ADDON_ID && item.isNative)
      ? { ...item, enabled }
      : item,
  );
  publish(true);
}

export function setAddonsFromRemote(remoteAddons: InstalledAddon[]) {
  addons = mergeWithNativeAddons(remoteAddons);
  publish(false);
}

export async function syncAndMigrateAddons(serverAddons?: InstalledAddon[]) {
  const account = useAuthStore.getState().account;
  const backendUrl = getActiveBackendUrl();

  const safeServerAddons = Array.isArray(serverAddons)
    ? getCustomAddons(serverAddons)
    : [];
  const localCustom = getCustomAddons();

  const merged = mergeAddonLists(localCustom, safeServerAddons);

  setAddonsFromRemote(merged);

  if (account && backendUrl) {
    const serverIds = new Set(
      safeServerAddons.map((a) => a.manifest.id || a.manifestUrl),
    );
    const hasUnsyncedLocal = localCustom.some(
      (a) => !serverIds.has(a.manifest.id || a.manifestUrl),
    );

    if (hasUnsyncedLocal || merged.length !== safeServerAddons.length) {
      try {
        await updateSettings(backendUrl, account, {
          addons: merged,
        });
      } catch (err) {
        console.error(
          "[addons] Failed to migrate/sync local addons to backend:",
          err,
        );
      }
    }
  }

  return merged;
}

export function resetAddonStorage(syncToBackend = false) {
  addons = mergeWithNativeAddons([]);
  publish(syncToBackend);
}
