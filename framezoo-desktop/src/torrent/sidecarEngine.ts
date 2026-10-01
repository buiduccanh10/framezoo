import {
  execSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

import type {
  TorrentSession,
  TorrentStartRequest,
  TorrentStatus,
} from "../types";
import { createTorrentSessionId } from "./rangeServer";
import type { TorrentEngine, TorrentStatusListener } from "./types";

type SidecarResponse = {
  type: "response";
  requestId: string;
  ok: boolean;
  error?: string;
  session?: Partial<TorrentSession> & {
    streamUrl?: string;
    streamType?: string;
  };
};

type SidecarStatus = {
  type: "status";
  status: TorrentStatus;
};

type PendingRequest = {
  resolve: (value: SidecarResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class SidecarTorrentEngine implements TorrentEngine {
  private static readonly PROCESS_EXIT_ERROR =
    "Torrent engine exited; stream is no longer available";
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly statuses = new Map<string, TorrentStatus>();
  private readonly listeners = new Map<string, TorrentStatusListener>();

  constructor(private readonly executablePath: string) {}

  async start(
    request: TorrentStartRequest,
    listener: TorrentStatusListener,
  ): Promise<TorrentSession> {
    await this.ensureProcess();
    const sessionId = createTorrentSessionId();
    this.listeners.set(sessionId, listener);
    try {
      const response = await this.send({
        type: "start",
        requestId: randomUUID(),
        sessionId,
        request,
      });

      if (!response.ok || !response.session?.streamUrl) {
        throw new Error(
          response.error ?? "torrent sidecar did not return a stream URL",
        );
      }

      const session: TorrentSession = {
        sessionId,
        sourceId: request.sourceId,
        streamUrl: response.session.streamUrl,
        streamType:
          (response.session.streamType as "pending" | "file") ?? "pending",
        startAt: response.session.startAt ?? request.startAt ?? 0,
        duration: response.session.duration ?? null,
        fileName: response.session.fileName ?? request.fileName ?? null,
        infoHash: response.session.infoHash ?? request.infoHash ?? null,
      };
      return session;
    } catch (error) {
      this.listeners.delete(sessionId);
      this.statuses.delete(sessionId);
      throw error;
    }
  }

  async stop(sessionId: string) {
    try {
      if (this.process) {
        await this.send(
          {
            type: "stop",
            requestId: randomUUID(),
            sessionId,
          },
          5_000,
        );
      }
    } catch (error) {
      console.warn("[torrent] sidecar stop failed:", error);
    } finally {
      this.listeners.delete(sessionId);
      this.statuses.delete(sessionId);
    }
  }

  async stopAll(): Promise<void> {
    const sessions = Array.from(this.statuses.keys());
    try {
      if (this.process?.stdin.writable) {
        await this.send(
          {
            type: "stop_all",
            requestId: randomUUID(),
          },
          5_000,
        );
      }
    } catch (error) {
      console.warn(
        "[torrent] sidecar stop_all failed, falling back to per-session stop:",
        error,
      );
      await Promise.allSettled(sessions.map((id) => this.stop(id)));
    } finally {
      this.listeners.clear();
      this.statuses.clear();
    }
  }

  getStatus(sessionId: string) {
    return this.statuses.get(sessionId) ?? null;
  }

  async dispose() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("torrent sidecar disposed"));
    }
    this.pending.clear();
    this.listeners.clear();
    this.statuses.clear();
    const proc = this.process;
    this.process = null;
    if (proc) {
      if (globalThis.process.platform === "win32" && proc.pid) {
        try {
          execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: "ignore" });
        } catch {
          proc.kill();
        }
      } else {
        proc.kill("SIGTERM");
        setTimeout(() => {
          try {
            if (proc.pid) proc.kill("SIGKILL");
          } catch {}
        }, 1500).unref();
      }
    }
  }

  async warmup(): Promise<void> {
    await this.ensureProcess();
    // Send a lightweight "ping" that forces _ensure_session() on the Python
    // side. This is where the OS network-permission dialog will appear so
    // it shows at startup rather than interrupting the first stream attempt.
    // 5-minute timeout gives the user ample time to respond to the dialog.
    const WARMUP_TIMEOUT_MS = 5 * 60 * 1000;
    await new Promise<void>((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        // Timeout is non-fatal for warmup – the session might still be fine.
        resolve();
      }, WARMUP_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });
      this.process?.stdin.write(
        `${JSON.stringify({ type: "ping", requestId })}\n`,
      );
    });
  }

  private async ensureProcess() {
    if (this.process) return;

    const process = spawn(this.executablePath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: globalThis.process.env,
      shell:
        globalThis.process.platform === "win32" &&
        this.executablePath.toLowerCase().endsWith(".cmd"),
    });
    this.process = process;

    process.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) {
        console.error("[torrent-sidecar]", message);
      }
    });

    const lineReader = createInterface({ input: process.stdout });
    lineReader.on("line", (line) => {
      let message: SidecarResponse | SidecarStatus;
      try {
        message = JSON.parse(line) as SidecarResponse | SidecarStatus;
      } catch {
        return;
      }

      if (message.type === "status") {
        this.statuses.set(message.status.sessionId, message.status);
        this.listeners.get(message.status.sessionId)?.(message.status);
        return;
      }

      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      pending.resolve(message);
    });

    process.once("exit", (code, signal) => {
      if (this.process !== process) return;

      this.process = null;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error(
            `torrent sidecar exited (${code ?? "no code"}${signal ? `, ${signal}` : ""})`,
          ),
        );
      }
      this.pending.clear();

      const updatedAt = Date.now();
      for (const [sessionId, status] of this.statuses) {
        const nextStatus: TorrentStatus = {
          ...status,
          state: "error",
          streamUrl: null,
          error: SidecarTorrentEngine.PROCESS_EXIT_ERROR,
          updatedAt,
        };
        this.statuses.set(sessionId, nextStatus);
        this.listeners.get(sessionId)?.(nextStatus);
      }
      this.listeners.clear();
    });
  }

  private send(message: Record<string, unknown>, timeoutMs = 180_000) {
    if (!this.process?.stdin.writable) {
      return Promise.reject(new Error("torrent sidecar is not running"));
    }

    const requestId = String(message.requestId);
    return new Promise<SidecarResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error(
            `torrent sidecar request (${String(message.type)}) timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.process?.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }
}
