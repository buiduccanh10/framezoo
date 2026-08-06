import { useSyncExternalStore } from "react";

import { loadAddonManifest } from "./client";
import {
  getInstalledAddons,
  removeAddon,
  setAddonEnabled,
  subscribeInstalledAddons,
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

export { removeAddon, setAddonEnabled };
