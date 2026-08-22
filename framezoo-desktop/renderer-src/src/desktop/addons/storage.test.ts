import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NATIVE_SUBTITLE_ADDON_ID,
  getInstalledAddons,
  removeAddon,
  resetAddonStorage,
  setAddonEnabled,
  upsertAddon,
} from "./storage";
import type { InstalledAddon } from "./types";

describe("addons storage", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
    });
    resetAddonStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a stable referential snapshot when no changes occur", () => {
    const first = getInstalledAddons();
    const second = getInstalledAddons();

    expect(first).toBe(second);
  });

  it("always includes the native subtitle addon with isNative: true", () => {
    const list = getInstalledAddons();
    const native = list.find(
      (item) => item.manifest.id === NATIVE_SUBTITLE_ADDON_ID,
    );

    expect(native).toBeDefined();
    expect(native?.isNative).toBe(true);
    expect(native?.enabled).toBe(true);
  });

  it("prevents removal of the native subtitle addon", () => {
    removeAddon(NATIVE_SUBTITLE_ADDON_ID);
    const list = getInstalledAddons();
    const native = list.find(
      (item) => item.manifest.id === NATIVE_SUBTITLE_ADDON_ID,
    );

    expect(native).toBeDefined();
  });

  it("allows installing, enabling, and removing user addons", () => {
    const userAddon: InstalledAddon = {
      manifestUrl: "https://example.com/manifest.json",
      baseUrl: "https://example.com/",
      manifest: {
        id: "com.example.user-addon",
        version: "1.0.0",
        name: "User Addon",
        resources: ["catalog"],
        types: ["movie"],
        catalogs: [],
      },
      enabled: true,
      addedAt: Date.now(),
    };

    upsertAddon(userAddon);
    let list = getInstalledAddons();
    expect(list).toHaveLength(2);
    expect(
      list.some((item) => item.manifest.id === "com.example.user-addon"),
    ).toBe(true);

    setAddonEnabled("com.example.user-addon", false);
    list = getInstalledAddons();
    expect(
      list.find((item) => item.manifest.id === "com.example.user-addon")
        ?.enabled,
    ).toBe(false);

    removeAddon("com.example.user-addon");
    list = getInstalledAddons();
    expect(list).toHaveLength(1);
    expect(list[0].manifest.id).toBe(NATIVE_SUBTITLE_ADDON_ID);
  });

  it("resets storage while preserving the native addon", () => {
    const userAddon: InstalledAddon = {
      manifestUrl: "https://example.com/manifest.json",
      baseUrl: "https://example.com/",
      manifest: {
        id: "com.example.temp",
        version: "1.0.0",
        name: "Temp",
        resources: ["catalog"],
        types: ["movie"],
        catalogs: [],
      },
      enabled: true,
      addedAt: Date.now(),
    };

    upsertAddon(userAddon);
    expect(getInstalledAddons()).toHaveLength(2);

    resetAddonStorage();
    const list = getInstalledAddons();
    expect(list).toHaveLength(1);
    expect(list[0].manifest.id).toBe(NATIVE_SUBTITLE_ADDON_ID);
  });
});
