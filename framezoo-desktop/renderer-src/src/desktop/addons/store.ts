import { useSyncExternalStore } from "react";

import { loadAddonManifest } from "./client";
import {
  getCustomAddons,
  getInstalledAddons,
  removeAddon,
  resetAddonStorage,
  setAddonEnabled,
  subscribeInstalledAddons,
  syncAndMigrateAddons,
  upsertAddon,
} from "./storage";

export function useInstalledAddons() {
  return useSyncExternalStore(
    subscribeInstalledAddons,
    getInstalledAddons,
    getInstalledAddons,
  );
}

export async function installAddon(input: string) {
  const addon = await loadAddonManifest(input);
  upsertAddon(addon);
  return addon;
}

export {
  getCustomAddons,
  removeAddon,
  resetAddonStorage,
  setAddonEnabled,
  syncAndMigrateAddons,
};
