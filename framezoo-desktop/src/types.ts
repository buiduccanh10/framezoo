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

export interface TorrentStorageInfo {
  path: string;
  usedBytes: number;
  maxBytes: number;
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

export interface LibMpvBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LibMpvSourceType = "file" | "mp4" | "hls" | "dash" | "web";

export interface LibMpvSourceRequest {
  url: string;
  type: LibMpvSourceType;
  startAt: number;
  autoplay: boolean;
  headers?: Record<string, string>;
  /** Set to true for torrent HTTP streams that may buffer before sending data. */
  isTorrent?: boolean;
  /**
   * Generation supplied by the renderer. The controller and native addon tag
   * every event with this value, so the renderer's own counter stays in sync
   * even when multiple loads are coalesced. When omitted, the controller falls
   * back to its own per-player counter.
   */
  generation?: number;
}

export interface LibMpvAudioRequest {
  url: string;
  startAt: number;
  duration: number;
  headers?: Record<string, string>;
}

export interface LibMpvPlayerEvent {
  playerId: string;
  playbackId?: string;
  generation: number;
  type:
    | "property"
    | "file-loaded"
    | "video-reconfig"
    | "video-frame"
    | "end-file"
    | "log"
    | "error";
  name?: string;
  data?: unknown;
  message?: string;
  level?: string;
}

export type LibMpvCommand =
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; time: number }
  | { type: "set-volume"; volume: number }
  | { type: "set-mute"; muted: boolean }
  | { type: "set-playback-rate"; rate: number }
  | { type: "set-audio-track"; trackId: string }
  | { type: "set-subtitle-track"; trackId: string }
  | { type: "set-secondary-subtitle-track"; trackId: string };

export interface LibMpvPlayerRequest {
  bounds: LibMpvBounds;
}

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
