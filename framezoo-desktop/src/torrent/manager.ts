import type {
  TorrentSession,
  TorrentStartRequest,
  TorrentStatus,
} from "../types";
import { FixtureTorrentEngine } from "./fixtureEngine";
import { SidecarTorrentEngine } from "./sidecarEngine";
import type { TorrentEngine, TorrentStatusListener } from "./types";
import { UnavailableTorrentEngine } from "./unavailableEngine";
import { resolveTorrentEnginePath } from "./paths";

export class TorrentManager {
  private readonly engine: TorrentEngine;
  private readonly statuses = new Map<string, TorrentStatus>();
  private readonly listeners = new Set<TorrentStatusListener>();

  constructor(options?: {
    engine?: TorrentEngine;
    fixtureFilePath?: string;
    fixtureIntervalMs?: number;
  }) {
    const enginePath = resolveTorrentEnginePath();
    if (!enginePath) {
      console.warn(
        "[torrent] No torrent engine binary found for",
        `${process.platform}-${process.arch}`,
        "– torrent streaming is unavailable. Build the sidecar on a native runner first.",
      );
    }
    this.engine =
      options?.engine ??
      (options?.fixtureFilePath
        ? new FixtureTorrentEngine({
            filePath: options.fixtureFilePath,
            intervalMs: options.fixtureIntervalMs,
          })
        : enginePath
          ? new SidecarTorrentEngine(enginePath)
          : new UnavailableTorrentEngine());
  }

  async start(request: TorrentStartRequest) {
    const session = await this.engine.start(request, (status) => {
      this.statuses.set(status.sessionId, status);
      for (const listener of this.listeners) listener(status);
    });
    return session;
  }

  async stop(sessionId: string) {
    await this.engine.stop(sessionId);
    this.statuses.delete(sessionId);
  }

  async stopAll() {
    const sessions = Array.from(this.statuses.keys());
    await Promise.allSettled(sessions.map((id) => this.stop(id)));
  }

  getStatus(sessionId: string) {
    return this.statuses.get(sessionId) ?? this.engine.getStatus(sessionId);
  }

  subscribe(listener: TorrentStatusListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async warmup() {
    if (typeof this.engine.warmup === "function") {
      await this.engine.warmup();
    }
  }

  async restartEngine() {
    await this.engine.dispose();
    this.statuses.clear();
    // We intentionally don't clear listeners so IPC bindings in main.ts survive.
  }

  async dispose() {
    await this.engine.dispose();
    this.statuses.clear();
    this.listeners.clear();
  }
}

export function createTorrentManagerFromEnvironment() {
  return new TorrentManager({
    fixtureFilePath: process.env.FRAMEZOO_TORRENT_FIXTURE_FILE,
  });
}
