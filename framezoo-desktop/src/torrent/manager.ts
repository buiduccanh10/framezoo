import type {
  TorrentSession,
  TorrentSettings,
  TorrentStartRequest,
  TorrentStatus,
} from "../types";
import { FixtureTorrentEngine } from "./fixtureEngine";
import { NodeTorrentEngine } from "./nodeEngine";
import type { TorrentEngine, TorrentStatusListener } from "./types";
import { UnavailableTorrentEngine } from "./unavailableEngine";
import { resolveTorrentEnginePath } from "./paths";

export class TorrentManager {
  private settings: TorrentSettings = {
    maxBytes: 5 * 1024 * 1024 * 1024,
    cacheRoot: null,
    profile: "default",
  };
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
        "[torrent] No Node torrent worker found for",
        `${process.platform}-${process.arch}`,
        "– torrent streaming is unavailable. Build the Node worker first or set FRAMEZOO_TORRENT_NODE_ENGINE_PATH.",
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
          ? new NodeTorrentEngine(enginePath)
          : new UnavailableTorrentEngine());
  }

  async start(request: TorrentStartRequest) {
    const session = await this.engine.start(
      {
        ...request,
        maxBytes: this.settings.maxBytes,
        cacheRoot: this.settings.cacheRoot,
        torrentProfile: this.settings.profile,
      },
      (status) => {
        this.statuses.set(status.sessionId, status);
        for (const listener of this.listeners) listener(status);
      },
    );
    return session;
  }

  configure(settings: TorrentSettings) {
    this.settings = settings;
  }

  async stop(sessionId: string) {
    await this.engine.stop(sessionId, this.settings.maxBytes === 0);
    this.statuses.delete(sessionId);
  }

  async stopAll() {
    const discardCache = this.settings.maxBytes === 0;
    if (typeof this.engine.stopAll === "function") {
      try {
        await this.engine.stopAll(discardCache);
      } catch (error) {
        console.warn("[torrent] engine.stopAll failed:", error);
      } finally {
        this.statuses.clear();
      }
      return;
    }
    const sessions = Array.from(this.statuses.keys());
    await Promise.allSettled(sessions.map((id) => this.stop(id)));
    this.statuses.clear();
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
