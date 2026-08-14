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
  /** Pre-initialize the engine so OS network-permission dialogs appear at
   *  startup rather than the first time a user tries to stream. Optional:
   *  engines that have nothing to warm up may omit this method. */
  warmup?(): Promise<void>;
}
