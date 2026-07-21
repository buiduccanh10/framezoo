import type {
  TorrentSession,
  TorrentStartRequest,
  TorrentStatus,
} from "../types";

export type TorrentStatusListener = (status: TorrentStatus) => void;

export interface TorrentEngine {
  start(
    request: TorrentStartRequest,
    onStatus: TorrentStatusListener,
  ): Promise<TorrentSession>;
  stop(sessionId: string): Promise<void>;
  getStatus(sessionId: string): TorrentStatus | null;
  dispose(): Promise<void>;
}
