import { registerSW } from "virtual:pwa-register";

import { useAppUpdateStore } from "@/stores/appUpdate";
import { TMDB_METADATA_CACHE_KEY, queryClient } from "@/utils/queryClient";

const intervalMS = 60 * 60 * 1000;
let isReloadingForUpdate = false;
type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

async function clearAppClientCaches() {
  queryClient.clear();

  try {
    window.localStorage.removeItem(TMDB_METADATA_CACHE_KEY);
  } catch (error) {
    console.warn("[PWA] Failed to clear query cache", error);
  }

  if (!("caches" in window)) return;

  try {
    const cacheKeys = await window.caches.keys();
    await Promise.all(
      cacheKeys.map((cacheKey) => window.caches.delete(cacheKey)),
    );
  } catch (error) {
    console.warn("[PWA] Failed to clear Cache Storage", error);
  }
}

async function hardRefreshToLatestBuild() {
  if (isReloadingForUpdate) return;
  isReloadingForUpdate = true;

  useAppUpdateStore.getState().setIsUpdating(true);
  await clearAppClientCaches();

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("__app_update", Date.now().toString());
  window.location.replace(nextUrl.toString());
}

let updateServiceWorker: UpdateServiceWorker | null = null;

export async function requestAppUpdate() {
  useAppUpdateStore.getState().setIsUpdating(true);

  if (!updateServiceWorker) {
    await hardRefreshToLatestBuild();
    return;
  }

  try {
    await updateServiceWorker(true);
    window.setTimeout(() => {
      void hardRefreshToLatestBuild();
    }, 3000);
  } catch (error) {
    console.error("[PWA] Failed to activate the waiting service worker", error);
    await hardRefreshToLatestBuild();
  }
}

updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() {
    useAppUpdateStore.getState().markUpdateAvailable();
  },
  onNeedReload() {
    void hardRefreshToLatestBuild();
  },
  onRegisteredSW(swUrl, r) {
    if (!r) return;
    setInterval(async () => {
      if (!(!r.installing && navigator)) return;

      if ("connection" in navigator && !navigator.onLine) return;

      const resp = await fetch(swUrl, {
        cache: "no-store",
        headers: {
          cache: "no-store",
          "cache-control": "no-cache",
        },
      });

      if (resp?.status === 200) {
        await r.update();
      }
    }, intervalMS);
  },
});
