import { stat } from "node:fs/promises";

import type {
  TorrentSession,
  TorrentStartRequest,
  TorrentStatus,
} from "../types";
import { createTorrentSessionId, TorrentRangeServer } from "./rangeServer";
import type { TorrentEngine, TorrentStatusListener } from "./types";

type FixtureSession = {
  request: TorrentStartRequest;
  status: TorrentStatus;
  timer: ReturnType<typeof setInterval>;
  listener: TorrentStatusListener;
};

export class FixtureTorrentEngine implements TorrentEngine {
  private readonly sessions = new Map<string, FixtureSession>();
  private readonly rangeServer = new TorrentRangeServer();
  private readonly filePath: string;
  private readonly intervalMs: number;

  constructor(options: { filePath: string; intervalMs?: number }) {
    this.filePath = options.filePath;
    this.intervalMs = options.intervalMs ?? 250;
  }

  async start(
    request: TorrentStartRequest,
    listener: TorrentStatusListener,
  ): Promise<TorrentSession> {
    const fileStats = await stat(this.filePath);
    await this.rangeServer.start();
    const sessionId = createTorrentSessionId();
    const streamUrl = this.rangeServer.register(sessionId, this.filePath);
    const infoHash = request.infoHash ?? extractInfoHash(request.url);
    const fileName = request.fileName ?? this.filePath.split("/").pop() ?? null;
    const now = Date.now();
    const status: TorrentStatus = {
      sessionId,
      sourceId: request.sourceId,
      state: "starting",
      progress: 0,
      speedBytesPerSecond: 0,
      peers: 0,
      infoHash,
      fileName,
      downloadedBytes: 0,
      totalBytes: fileStats.size,
      streamUrl,
      error: null,
      updatedAt: now,
    };

    const fixtureSession = {
      request,
      status,
      listener,
      timer: setInterval(() => undefined, this.intervalMs),
    };
    clearInterval(fixtureSession.timer);
    fixtureSession.timer = setInterval(() => {
      const current = this.sessions.get(sessionId);
      if (!current) return;

      const previousDownloaded = current.status.downloadedBytes;
      const nextDownloaded = Math.min(
        fileStats.size,
        previousDownloaded + Math.max(1, Math.ceil(fileStats.size * 0.08)),
      );
      const speed = Math.round(
        ((nextDownloaded - previousDownloaded) * 1000) / this.intervalMs,
      );
      const progress =
        fileStats.size === 0 ? 100 : (nextDownloaded / fileStats.size) * 100;

      current.status = {
        ...current.status,
        state: progress >= 100 ? "ready" : "downloading",
        progress,
        speedBytesPerSecond: speed,
        peers: progress >= 100 ? 1 : 3,
        downloadedBytes: nextDownloaded,
        updatedAt: Date.now(),
      };
      current.listener(current.status);

      if (progress >= 100) {
        clearInterval(current.timer);
      }
    }, this.intervalMs);
    this.sessions.set(sessionId, fixtureSession);
    listener(status);
    listener({ ...status, state: "buffering", peers: 1, updatedAt: Date.now() });

    return {
      sessionId,
      sourceId: request.sourceId,
      streamUrl,
      fileName,
      infoHash,
    };
  }

  async stop(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    clearInterval(session.timer);
    session.status = {
      ...session.status,
      state: "stopped",
      speedBytesPerSecond: 0,
      updatedAt: Date.now(),
    };
    session.listener(session.status);
    this.sessions.delete(sessionId);
    this.rangeServer.unregister(sessionId);
  }

  getStatus(sessionId: string) {
    return this.sessions.get(sessionId)?.status ?? null;
  }

  async dispose() {
    for (const sessionId of this.sessions.keys()) {
      await this.stop(sessionId);
    }
    await this.rangeServer.close();
  }
}

function extractInfoHash(url: string) {
  try {
    const parsed = new URL(url);
    const value = parsed.searchParams.get("xt") ?? "";
    return value.replace(/^urn:btih:/i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}
