import { registerSW } from "virtual:pwa-register";

import {
  DesktopAppUpdateState,
  getDesktopUpdateElectronApi,
} from "@/desktop/electron";
import { APP_VERSION } from "@/setup/constants";
import { useAppUpdateStore } from "@/stores/appUpdate";
import { TMDB_METADATA_CACHE_KEY, queryClient } from "@/utils/queryClient";

const intervalMS = 60 * 60 * 1000;
let isReloadingForUpdate = false;
let registeredServiceWorkerUrl: string | null = null;
let lastKnownServiceWorkerToken: string | null = null;
let latestDiscoveredUpdateToken: string | null = null;
let hasAttachedReminderListeners = false;
type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;
let hasInitializedDesktopAppUpdate = false;

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

function getServiceWorkerToken(swUrl: string, resp: Response) {
  const etag = resp.headers.get("etag");
  const lastModified = resp.headers.get("last-modified");
  const contentLength = resp.headers.get("content-length");

  return [swUrl, etag, lastModified, contentLength]
    .filter((value) => !!value)
    .join("::");
}

async function fetchServiceWorkerToken(swUrl: string) {
  try {
    const resp = await fetch(swUrl, {
      cache: "no-store",
      headers: {
        cache: "no-store",
        "cache-control": "no-cache",
      },
    });

    if (resp.status !== 200) return null;
    return getServiceWorkerToken(swUrl, resp);
  } catch {
    return null;
  }
}

async function resolvePendingUpdateToken() {
  const registration = await navigator.serviceWorker?.getRegistration?.();
  const waitingServiceWorkerUrl = registration?.waiting?.scriptURL ?? null;

  if (waitingServiceWorkerUrl) {
    const waitingToken = await fetchServiceWorkerToken(waitingServiceWorkerUrl);
    if (waitingToken) return waitingToken;
  }

  return (
    latestDiscoveredUpdateToken ??
    waitingServiceWorkerUrl ??
    registeredServiceWorkerUrl ??
    APP_VERSION
  );
}

async function markAppUpdateAvailable() {
  const updateToken = await resolvePendingUpdateToken();
  useAppUpdateStore.getState().markUpdateAvailable({
    updateToken,
  });
}

function syncAppUpdateVisibility() {
  useAppUpdateStore.getState().syncUpdateVisibility();
}

function attachAppUpdateReminderListeners() {
  if (hasAttachedReminderListeners || typeof window === "undefined") return;
  hasAttachedReminderListeners = true;

  window.addEventListener("focus", syncAppUpdateVisibility);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    syncAppUpdateVisibility();
  });
}

async function hardRefreshToLatestBuild() {
  if (isReloadingForUpdate) return;
  isReloadingForUpdate = true;

  useAppUpdateStore.getState().setUpdateProgress(100);
  await clearAppClientCaches();

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("__app_update", Date.now().toString());
  window.location.replace(nextUrl.toString());
}

let updateServiceWorker: UpdateServiceWorker | null = null;

function isDesktopAppRuntime() {
  return typeof window !== "undefined" && Boolean(window.__ALPHAFLIX_DESKTOP__);
}

function applyDesktopUpdateState(state: DesktopAppUpdateState) {
  const store = useAppUpdateStore.getState();

  switch (state.status) {
    case "idle":
      store.clearUpdate();
      return;
    case "checking":
      store.markChecking();
      return;
    case "available":
      store.markUpdateAvailable({
        updateToken: state.updateToken ?? state.updateVersion ?? APP_VERSION,
        updateVersion: state.updateVersion,
      });
      return;
    case "downloading":
      store.setUpdateProgress(state.progressPercent ?? 0);
      return;
    case "downloaded":
      store.markUpdateDownloaded({
        updateToken: state.updateToken ?? state.updateVersion ?? APP_VERSION,
        updateVersion: state.updateVersion,
      });
      return;
    case "error":
      store.markUpdateError(state.errorMessage);
      return;
  }
}

function initializeDesktopAppUpdate() {
  if (hasInitializedDesktopAppUpdate || !isDesktopAppRuntime()) return;

  const electronApi = getDesktopUpdateElectronApi();
  if (!electronApi) return;

  hasInitializedDesktopAppUpdate = true;
  attachAppUpdateReminderListeners();

  void electronApi.getAppUpdateState().then(applyDesktopUpdateState);
  electronApi.onAppUpdateState(applyDesktopUpdateState);

  window.setTimeout(() => {
    void electronApi.checkForAppUpdate();
  }, 5000);
}

export async function checkForAppUpdate() {
  if (isDesktopAppRuntime()) {
    const electronApi = getDesktopUpdateElectronApi();
    if (!electronApi) return false;

    useAppUpdateStore.getState().markChecking();
    return electronApi.checkForAppUpdate();
  }

  return false;
}

export async function requestAppUpdate() {
  if (isDesktopAppRuntime()) {
    const electronApi = getDesktopUpdateElectronApi();
    if (!electronApi) return;

    const { status } = useAppUpdateStore.getState();
    if (status === "downloaded") {
      useAppUpdateStore.getState().setUpdateProgress(100);
      await electronApi.installAppUpdate();
      return;
    }

    if (status !== "available" && status !== "error") {
      useAppUpdateStore.getState().markChecking();
      await electronApi.checkForAppUpdate();
      return;
    }

    useAppUpdateStore.getState().setUpdateProgress(0);
    await electronApi.downloadAppUpdate();
    return;
  }

  useAppUpdateStore.getState().setUpdateProgress(100);

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

if (isDesktopAppRuntime()) {
  initializeDesktopAppUpdate();
} else {
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      void markAppUpdateAvailable();
    },
    onNeedReload() {
      void hardRefreshToLatestBuild();
    },
    onRegisteredSW(swUrl, r) {
      if (!r) return;
      registeredServiceWorkerUrl = swUrl;
      attachAppUpdateReminderListeners();
      void fetchServiceWorkerToken(swUrl).then((token) => {
        if (!token) return;
        lastKnownServiceWorkerToken = token;
      });

      setInterval(async () => {
        if (!(!r.installing && navigator)) return;

        if ("connection" in navigator && !navigator.onLine) return;

        const serviceWorkerToken = await fetchServiceWorkerToken(swUrl);

        if (serviceWorkerToken) {
          if (!lastKnownServiceWorkerToken) {
            lastKnownServiceWorkerToken = serviceWorkerToken;
          } else if (serviceWorkerToken !== lastKnownServiceWorkerToken) {
            latestDiscoveredUpdateToken = serviceWorkerToken;
          }
        }

        await r.update();
      }, intervalMS);
    },
  });
}
