export type ExtensionMessageName =
  | "hello"
  | "makeRequest"
  | "prepareStream"
  | "openPage";

export type TorrentLifecycle =
  | "starting"
  | "buffering"
  | "ready"
  | "downloading"
  | "stopped"
  | "error";

export interface TorrentStartRequest {
  sourceId: string;
  url: string;
  infoHash?: string;
  fileIdx?: number;
  fileName?: string;
  startAt?: number;
}

export interface TorrentStatus {
  sessionId: string;
  sourceId: string;
  state: TorrentLifecycle;
  progress: number;
  speedBytesPerSecond: number;
  peers: number;
  infoHash: string | null;
  fileName: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  streamType?: "pending" | "hls" | "file";
  streamUrl: string | null;
  startAt?: number;
  duration?: number | null;
  error: string | null;
  updatedAt: number;
}

export interface TorrentSession {
  sessionId: string;
  sourceId: string;
  streamUrl: string;
  streamType: "pending" | "hls" | "file";
  startAt?: number;
  duration?: number | null;
  fileName: string | null;
  infoHash: string | null;
}

export type StreamRule = {
  targetDomains: string[];
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
};

export type DesktopAppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopAppUpdateState = {
  status: DesktopAppUpdateStatus;
  updateToken: string | null;
  updateVersion: string | null;
  progressPercent: number | null;
  errorMessage: string | null;
};

export type CreateDesktopAppUpdaterOptions = {
  appName: string;
  checkIntervalMs: number;
  getBackendUrl: () => string;
  onStateChange?: (state: DesktopAppUpdateState) => void;
  updateChannel: string;
};

export type DesktopPipState = Record<string, unknown> | null;

export interface DesktopPipWindowSize {
  width: number;
  height: number;
}

export type CreateDesktopPipControllerOptions = {
  desktopPipRoute: string;
  enableDevTools: boolean;
  onClosed?: () => void;
  preloadPath: string;
  rendererAppUrl?: string;
  rendererDevUrl?: string;
  rendererEntryPath: string;
};
