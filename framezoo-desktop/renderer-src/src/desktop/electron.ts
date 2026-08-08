export type DesktopAppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export interface DesktopAppUpdateState {
  status: DesktopAppUpdateStatus;
  updateToken: string | null;
  updateVersion: string | null;
  progressPercent: number | null;
  errorMessage: string | null;
}

export interface DesktopUpdateElectronApi {
  getAppUpdateState(): Promise<DesktopAppUpdateState>;
  checkForAppUpdate(): Promise<boolean>;
  downloadAppUpdate(): Promise<boolean>;
  installAppUpdate(): Promise<boolean>;
  onAppUpdateState(
    listener: (state: DesktopAppUpdateState) => void,
  ): () => void;
}

import type {
  AddonProtocolRequest,
  AddonProtocolResponse,
} from "./addons/nativeTypes";
import type {
  TorrentSession,
  TorrentStartRequest,
  TorrentStatus,
} from "./torrentTypes";

declare global {
  interface Window {
    electronAPI?: {
      getAppUpdateState?: () => Promise<DesktopAppUpdateState>;
      checkForAppUpdate?: () => Promise<boolean>;
      downloadAppUpdate?: () => Promise<boolean>;
      installAppUpdate?: () => Promise<boolean>;
      onAppUpdateState?: (
        listener: (state: DesktopAppUpdateState) => void,
      ) => () => void;
      startTorrent?: (request: TorrentStartRequest) => Promise<TorrentSession>;
      stopTorrent?: (sessionId: string) => Promise<boolean>;
      getTorrentStatus?: (sessionId: string) => Promise<TorrentStatus | null>;
      onTorrentStatus?: (
        listener: (status: TorrentStatus) => void,
      ) => () => void;
      sendExtensionMessage?: (
        name: string,
        payload?: unknown,
      ) => Promise<unknown>;
      openExternal?: (url: string) => Promise<boolean>;
      addons?: {
        loadManifest?: (manifestUrl: string) => Promise<AddonProtocolResponse>;
        request?: (
          request: AddonProtocolRequest,
        ) => Promise<AddonProtocolResponse>;
      };
      onDeepLink?: (listener: (url: string) => void) => () => void;
    };
    __CONFIG__?: Record<string, string>;
  }
}

export interface DesktopAddonElectronApi {
  loadManifest(manifestUrl: string): Promise<AddonProtocolResponse>;
  request(request: AddonProtocolRequest): Promise<AddonProtocolResponse>;
}

export function getDesktopAddonElectronApi(): DesktopAddonElectronApi | null {
  const api = window.electronAPI;
  if (
    !window.__FRAMEZOO_DESKTOP__ ||
    typeof api?.addons?.loadManifest !== "function" ||
    typeof api.addons.request !== "function"
  ) {
    return null;
  }

  return api.addons as DesktopAddonElectronApi;
}

export function getDesktopUpdateElectronApi(): DesktopUpdateElectronApi | null {
  const electronApi = window.electronAPI;
  if (
    !electronApi ||
    typeof electronApi.getAppUpdateState !== "function" ||
    typeof electronApi.checkForAppUpdate !== "function" ||
    typeof electronApi.downloadAppUpdate !== "function" ||
    typeof electronApi.installAppUpdate !== "function" ||
    typeof electronApi.onAppUpdateState !== "function"
  ) {
    return null;
  }

  return electronApi as DesktopUpdateElectronApi;
}
