import { conf } from "@/setup/config";

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
  const manifestUrl = backendBase
    ? `${backendBase}/addon/subtitles/manifest.json`
    : "/addon/subtitles/manifest.json";
  const baseUrl = backendBase
    ? `${backendBase}/addon/subtitles/`
    : "/addon/subtitles/";

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

function publish() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(addons));
  for (const listener of listeners) listener();
}

export function getInstalledAddons(): InstalledAddon[] {
  return addons;
}

export function subscribeInstalledAddons(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
  publish();
}

export function removeAddon(id: string) {
  if (id === NATIVE_SUBTITLE_ADDON_ID) return;
  const target = addons.find((item) => item.manifest.id === id);
  if (target?.isNative) return;

  addons = addons.filter((item) => item.manifest.id !== id);
  publish();
}

export function setAddonEnabled(id: string, enabled: boolean) {
  addons = addons.map((item) =>
    item.manifest.id === id ||
    (id === NATIVE_SUBTITLE_ADDON_ID && item.isNative)
      ? { ...item, enabled }
      : item,
  );
  publish();
}

export function resetAddonStorage() {
  addons = mergeWithNativeAddons([]);
  publish();
}
