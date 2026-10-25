import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NATIVE_SUBTITLE_ADDON_ID,
  getCustomAddons,
  getInstalledAddons,
  mergeAddonLists,
  removeAddon,
  resetAddonStorage,
  setAddonEnabled,
  syncAndMigrateAddons,
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

  it("merges remote and local addon lists correctly", () => {
    const localAddon: InstalledAddon = {
      manifestUrl: "https://local.example/manifest.json",
      baseUrl: "https://local.example/",
      manifest: {
        id: "com.example.local",
        version: "1.0.0",
        name: "Local Addon",
      },
      enabled: true,
      addedAt: 1000,
    };

    const remoteAddon: InstalledAddon = {
      manifestUrl: "https://remote.example/manifest.json",
      baseUrl: "https://remote.example/",
      manifest: {
        id: "com.example.remote",
        version: "1.0.0",
        name: "Remote Addon",
      },
      enabled: true,
      addedAt: 2000,
    };

    const overlapUpdated: InstalledAddon = {
      manifestUrl: "https://local.example/manifest.json",
      baseUrl: "https://local.example/",
      manifest: {
        id: "com.example.local",
        version: "2.0.0",
        name: "Local Addon Updated",
      },
      enabled: true,
      addedAt: 3000,
    };

    const merged = mergeAddonLists([overlapUpdated], [remoteAddon, localAddon]);
    expect(merged).toHaveLength(2);
    expect(
      merged.find((a) => a.manifest.id === "com.example.remote"),
    ).toBeDefined();
    const localInMerged = merged.find(
      (a) => a.manifest.id === "com.example.local",
    );
    expect(localInMerged?.manifest.version).toBe("2.0.0");
  });

  it("syncs and migrates existing local addons when updated from server", async () => {
    const existingLocalAddon: InstalledAddon = {
      manifestUrl: "https://existing.example/manifest.json",
      baseUrl: "https://existing.example/",
      manifest: {
        id: "com.example.existing",
        version: "1.0.0",
        name: "Existing Local",
      },
      enabled: true,
      addedAt: Date.now(),
    };

    upsertAddon(existingLocalAddon);
    expect(getCustomAddons()).toHaveLength(1);

    // Server returns another addon
    const serverAddon: InstalledAddon = {
      manifestUrl: "https://server.example/manifest.json",
      baseUrl: "https://server.example/",
      manifest: {
        id: "com.example.server",
        version: "1.0.0",
        name: "Server Addon",
      },
      enabled: true,
      addedAt: Date.now(),
    };

    const result = await syncAndMigrateAddons([serverAddon]);
    expect(result).toHaveLength(2);
    expect(result.some((a) => a.manifest.id === "com.example.existing")).toBe(
      true,
    );
    expect(result.some((a) => a.manifest.id === "com.example.server")).toBe(
      true,
    );

    const installed = getInstalledAddons();
    expect(installed).toHaveLength(3); // 2 custom + 1 native
  });
});
