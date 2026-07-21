import type { InstalledAddon } from "./types";

const STORAGE_KEY = "betamovie.desktop.addons.v1";

function readAddons() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? (value as InstalledAddon[]) : [];
  } catch {
    return [];
  }
}

let addons = readAddons();
const listeners = new Set<() => void>();

function publish() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(addons));
  for (const listener of listeners) listener();
}

export function getInstalledAddons() {
  return addons;
}

export function subscribeInstalledAddons(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function upsertAddon(addon: InstalledAddon) {
  addons = [
    ...addons.filter((item) => item.manifest.id !== addon.manifest.id),
    addon,
  ];
  publish();
}

export function removeAddon(id: string) {
  addons = addons.filter((item) => item.manifest.id !== id);
  publish();
}

export function setAddonEnabled(id: string, enabled: boolean) {
  addons = addons.map((item) =>
    item.manifest.id === id ? { ...item, enabled } : item,
  );
  publish();
}

export function resetAddonStorage() {
  addons = [];
  publish();
}
