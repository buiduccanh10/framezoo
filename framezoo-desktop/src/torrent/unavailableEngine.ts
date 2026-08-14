import type {
  TorrentSession,
  TorrentStartRequest,
  TorrentStatus,
} from "../types";
import type { TorrentEngine, TorrentStatusListener } from "./types";

export class UnavailableTorrentEngine implements TorrentEngine {
  async start(
    _request: TorrentStartRequest,
    _listener: TorrentStatusListener,
  ): Promise<TorrentSession> {
    throw new Error(
      "Native torrent engine is unavailable. Run the desktop torrent setup or provide FRAMEZOO_TORRENT_ENGINE_PATH.",
    );
  }

  async stop(_sessionId: string) {}

  getStatus(_sessionId: string): TorrentStatus | null {
    return null;
  }

  async warmup() {
    throw new Error(
      "Native torrent engine is unavailable. Run the desktop torrent setup or provide FRAMEZOO_TORRENT_ENGINE_PATH.",
    );
  }

  async dispose() {}
}
