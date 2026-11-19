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
      "Node torrent worker is unavailable. Build the desktop shell or provide FRAMEZOO_TORRENT_NODE_ENGINE_PATH. Python rollback: FRAMEZOO_TORRENT_PYTHON_ENGINE_PATH.",
    );
  }

  async stop(_sessionId: string) {}

  getStatus(_sessionId: string): TorrentStatus | null {
    return null;
  }

  async warmup() {
    throw new Error(
      "Node torrent worker is unavailable. Build the desktop shell or provide FRAMEZOO_TORRENT_NODE_ENGINE_PATH. Python rollback: FRAMEZOO_TORRENT_PYTHON_ENGINE_PATH.",
    );
  }

  async dispose() {}
}
