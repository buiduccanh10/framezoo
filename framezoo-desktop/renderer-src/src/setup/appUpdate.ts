import type { DesktopAppUpdateState } from "@/desktop/electron";
import { getDesktopUpdateElectronApi } from "@/desktop/electron";
import { APP_VERSION } from "@/setup/constants";
import { useAppUpdateStore } from "@/stores/appUpdate";

let hasInitializedDesktopAppUpdate = false;

function isDesktopAppRuntime() {
  return typeof window !== "undefined" && Boolean(window.__FRAMEZOO_DESKTOP__);
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
  void electronApi.getAppUpdateState().then(applyDesktopUpdateState);
  electronApi.onAppUpdateState(applyDesktopUpdateState);

  window.setTimeout(() => {
    void electronApi.checkForAppUpdate();
  }, 5000);
}

export async function checkForAppUpdate() {
  if (!isDesktopAppRuntime()) return false;

  const electronApi = getDesktopUpdateElectronApi();
  if (!electronApi) return false;

  useAppUpdateStore.getState().markChecking();
  return electronApi.checkForAppUpdate();
}

export async function requestAppUpdate() {
  if (!isDesktopAppRuntime()) return;

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
}

initializeDesktopAppUpdate();
