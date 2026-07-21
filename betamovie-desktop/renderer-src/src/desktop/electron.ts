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
    };
    __CONFIG__?: Record<string, string>;
  }
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
