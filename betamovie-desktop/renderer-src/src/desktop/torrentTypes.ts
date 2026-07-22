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
  streamUrl: string | null;
  error: string | null;
  updatedAt: number;
}

export interface TorrentSession {
  sessionId: string;
  sourceId: string;
  streamUrl: string;
  streamType: "hls" | "file";
  duration?: number | null;
  fileName: string | null;
  infoHash: string | null;
}
