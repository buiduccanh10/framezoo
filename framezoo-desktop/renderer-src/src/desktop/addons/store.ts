import { useSyncExternalStore } from "react";

import { fetchComplianceBlocklist, isDomainInBlocklist } from "./blocklist";
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
  const blocklist = await fetchComplianceBlocklist();
  if (isDomainInBlocklist(input, blocklist.addonDomains)) {
    throw new Error(
      "This addon domain has been blocked due to a copyright/legal takedown notice.",
    );
  }
  const addon = await loadAddonManifest(input);
  if (isDomainInBlocklist(addon.manifestUrl, blocklist.addonDomains)) {
    throw new Error(
      "This addon domain has been blocked due to a copyright/legal takedown notice.",
    );
  }
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
