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

export type NativeWarmupComponentState =
  | { status: "idle" | "warming" | "ready" }
  | { status: "error"; message: string };

export interface NativeStartupWarmupState {
  status: "idle" | "warming" | "ready" | "degraded";
  torrent: NativeWarmupComponentState;
  libmpv: NativeWarmupComponentState;
  moonshine?: NativeWarmupComponentState;
}

import type {
  AddonProtocolRequest,
  AddonProtocolResponse,
} from "./addons/nativeTypes";
import type {
  TorrentSession,
  TorrentStartRequest,
  TorrentStatus,
  TorrentStorageInfo,
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
      setTorrentMaxSize?: (size: string | null) => Promise<boolean>;
      getTorrentStorageInfo?: () => Promise<TorrentStorageInfo>;
      clearTorrentStorage?: () => Promise<boolean>;
      onTorrentStatus?: (
        listener: (status: TorrentStatus) => void,
      ) => () => void;
      getStartupNativeWarmupState?: () => Promise<NativeStartupWarmupState>;
      waitForStartupNativeWarmup?: () => Promise<NativeStartupWarmupState>;
      getLibMpvDiagnostics?: () => Promise<{
        diagnostics: string;
        lastError: string | null;
        lastCreateError: string | null;
      } | null>;
      onStartupNativeWarmupState?: (
        listener: (state: NativeStartupWarmupState) => void,
      ) => () => void;
      cancelLibMpvAudio?: (requestId: string) => Promise<boolean>;
      hasMoonshineModel?: (
        architecture: "tiny" | "base",
        language: string,
      ) => Promise<boolean>;
      loadMoonshineLocalModel?: (model: {
        language: string;
        architecture: "tiny" | "base";
        bundled: boolean;
        files: Array<{ name: string; url: string }>;
      }) => Promise<boolean>;
      transcribeMoonshineLocal?: (
        requestId: string,
        model: {
          language: string;
          architecture: "tiny" | "base";
          bundled: boolean;
          files: Array<{ name: string; url: string }>;
        },
        audio: ArrayBuffer,
        sampleRate: number,
      ) => Promise<
        | {
            lines: Array<{ startTime: number; duration: number }>;
          }
        | {
            cancelled: true;
          }
      >;
      cancelMoonshineLocal?: (requestId: string) => Promise<boolean>;
      downloadMoonshineModel?: (
        requestId: string,
        request: {
          architecture: "tiny" | "base";
          language: string;
          files: Array<{
            name: string;
            url: string;
            size: number;
            checksum: string | null;
            checksumType: string | null;
          }>;
        },
      ) => Promise<boolean>;
      cancelMoonshineModelDownload?: (requestId: string) => Promise<boolean>;
      onMoonshineModelDownloadProgress?: (
        listener: (progress: {
          requestId: string;
          language: string;
          architecture: "tiny" | "base";
          file: string;
          loaded: number;
          total: number;
        }) => void,
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
