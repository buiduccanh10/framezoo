import { app, BrowserWindow, ipcMain, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import type {
  LibMpvAudioRequest,
  LibMpvBounds,
  LibMpvCommand,
  LibMpvPlayerEvent,
  LibMpvPlayerRequest,
  LibMpvSourceRequest,
} from "./types";

type NativePlayerEvent = LibMpvPlayerEvent;

interface NativeLibMpvAddon {
  warmup?(): boolean;
  createPlayer(
    parentHandle: Buffer,
    bounds: LibMpvBounds,
    callback: (event: NativePlayerEvent) => void,
  ): string;
  resizePlayer(playerId: string, bounds: LibMpvBounds): void;
  reparentPlayer(playerId: string, parentHandle: Buffer): void;
  loadPlayer(
    playerId: string,
    request: LibMpvSourceRequest & { generation: number },
  ): void;
  commandPlayer(playerId: string, command: LibMpvCommand): void;
  extractAudio(
    request: LibMpvAudioRequest & { outputPath: string },
  ): Promise<string>;
  destroyPlayer(playerId: string): void;
  configureWindow?(parentHandle: Buffer): void;
}

type PlayerRecord = {
  id: string;
  generation: number;
  bounds: LibMpvBounds;
  target: "main" | "pip";
  loadStartedAtMs?: number;
  isTorrent?: boolean;
  pipResizeListener?: () => void;
  pipWindow?: BrowserWindow;
};

const DEFAULT_NATIVE_EVENT_TIMEOUT_MS = 120_000;
const FILE_NATIVE_EVENT_TIMEOUT_MS = 45_000;
// Torrent streams must buffer pieces before the first bytes arrive.
// Give them much more time before treating the load as failed.
const TORRENT_NATIVE_EVENT_TIMEOUT_MS = 600_000; // 10 minutes

function isSupportedDesktopPlatform(): boolean {
  return process.platform === "darwin" || process.platform === "win32";
}

function getNativeAddonCandidates(): string[] {
  const target = `${process.platform}-${process.arch}`;
  const candidates = [
    process.env.FRAMEZOO_LIBMPV_ADDON,
    app.isPackaged
      ? path.join(process.resourcesPath, "native", "libmpv.node")
      : null,
    path.join(process.cwd(), "resources", "native", target, "libmpv.node"),
    path.join(process.cwd(), "native", "build", target, "libmpv.node"),
    path.join(__dirname, "..", "native", "build", target, "libmpv.node"),
  ];

  return candidates.filter((candidate): candidate is string =>
    Boolean(candidate),
  );
}

function configureNativeRuntime(): void {
  const target = `${process.platform}-${process.arch}`;
  const runtimeName =
    process.platform === "win32" ? "libmpv-2.dll" : "libmpv.2.dylib";
  const candidates = [
    process.env.FRAMEZOO_LIBMPV_PATH,
    app.isPackaged
      ? path.join(process.resourcesPath, "libmpv", runtimeName)
      : null,
    path.join(process.cwd(), "resources", "libmpv", target, runtimeName),
    path.join(__dirname, "..", "resources", "libmpv", target, runtimeName),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const runtimePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (runtimePath) {
    process.env.FRAMEZOO_LIBMPV_PATH = runtimePath;
    if (process.platform === "win32") {
      const libDir = path.dirname(runtimePath);
      const currentPath = process.env.PATH || "";
      if (!currentPath.split(";").includes(libDir)) {
        process.env.PATH = `${libDir};${currentPath}`;
        console.log(`[libmpv] added to PATH on Windows: ${libDir}`);
      }
    }
  }
}

function getNativeAddon(): NativeLibMpvAddon | null {
  if (!isSupportedDesktopPlatform()) return null;

  configureNativeRuntime();

  const require = createRequire(__filename);
  for (const candidate of getNativeAddonCandidates()) {
    if (!fs.existsSync(candidate)) continue;

    try {
      return require(candidate) as NativeLibMpvAddon;
    } catch (error) {
      console.error("[libmpv] failed to load native addon", {
        candidate,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

function normalizeBounds(bounds: LibMpvBounds, scaleFactor = 1): LibMpvBounds {
  return {
    x: Math.round((Number.isFinite(bounds.x) ? bounds.x : 0) * scaleFactor),
    y: Math.round((Number.isFinite(bounds.y) ? bounds.y : 0) * scaleFactor),
    width: Math.max(
      1,
      Math.round(
        (Number.isFinite(bounds.width) ? bounds.width : 1) * scaleFactor,
      ),
    ),
    height: Math.max(
      1,
      Math.round(
        (Number.isFinite(bounds.height) ? bounds.height : 1) * scaleFactor,
      ),
    ),
  };
}

function getNativeScaleFactor(window: BrowserWindow): number {
  if (process.platform !== "win32") return 1;
  const [x, y] = window.getPosition();
  return screen.getDisplayNearestPoint({ x, y }).scaleFactor || 1;
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = parsed.search ? "?[redacted]" : "";
    return parsed.toString();
  } catch {
    return "[invalid-url]";
  }
}

function redactLogMessage(message: string | undefined): string | undefined {
  if (!message) return message;
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactUrl(url))
    .replace(
      /\b(authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\s,]+/gi,
      "$1: [redacted]",
    );
}

export class LibMpvController {
  private mainWindow: BrowserWindow | null = null;
  private pipWindowProvider: (() => BrowserWindow | null) | null = null;
  private addon: NativeLibMpvAddon | null = null;
  private players = new Map<string, PlayerRecord>();
  private eventTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private ipcRegistered = false;
  private startupPreflight: (() => Promise<void>) | null = null;
  private warmupPromise: Promise<{ ok: boolean; message?: string }> | null =
    null;

  public init(
    mainWindow: BrowserWindow,
    pipWindowProvider?: () => BrowserWindow | null,
    startupPreflight?: () => Promise<void>,
  ): void {
    this.mainWindow = mainWindow;
    this.pipWindowProvider = pipWindowProvider ?? null;
    this.startupPreflight = startupPreflight ?? null;
    configureNativeRuntime();
    this.addon = getNativeAddon();

    if (!this.addon) {
      console.warn("[libmpv] native addon unavailable", {
        platform: process.platform,
        arch: process.arch,
        candidates: getNativeAddonCandidates(),
      });
    } else if (this.addon.configureWindow && process.platform === "darwin") {
      try {
        this.addon.configureWindow(mainWindow.getNativeWindowHandle());
      } catch (err) {
        console.warn("[libmpv] failed to configure window titlebar", err);
      }
    }

    this.registerIpc();

    mainWindow.on("resize", () => {
      this.broadcastLog("debug", "window_resized");
    });
    mainWindow.on("minimize", () => {
      for (const player of this.players.values()) {
        this.addon?.resizePlayer(player.id, player.bounds);
      }
    });
    mainWindow.on("closed", () => {
      this.destroyAll();
    });
  }

  public warmup(): Promise<{ ok: boolean; message?: string }> {
    if (this.warmupPromise) return this.warmupPromise;

    this.warmupPromise = (async () => {
      if (!this.addon || !this.mainWindow || this.mainWindow.isDestroyed()) {
        const message = "Native libmpv addon is unavailable";
        console.warn(
          "[libmpv] startup warmup skipped: native addon unavailable",
        );
        return { ok: false, message };
      }

      try {
        if (this.addon.warmup) {
          if (!this.addon.warmup()) {
            throw new Error("native libmpv warmup failed");
          }
        } else {
          // Keep compatibility with an older staged addon during app updates.
          const playerId = this.addon.createPlayer(
            this.mainWindow.getNativeWindowHandle(),
            { x: 0, y: 0, width: 1, height: 1 },
            () => undefined,
          );
          // Creating the idle player loads and initializes the libmpv runtime.
          this.addon.destroyPlayer(playerId);
        }

        this.broadcastLog("info", "startup_warmup", {
          component: "libmpv",
        });
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[libmpv] startup warmup failed", {
          error: message,
        });
        return { ok: false, message };
      }
    })();

    return this.warmupPromise;
  }

  private async waitForStartupPreflight(): Promise<void> {
    if (!this.startupPreflight) return;
    try {
      await this.startupPreflight();
    } catch (error) {
      // Preflight is best-effort. Do not block playback forever if a native
      // component fails during startup.
      console.warn("[libmpv] startup preflight wait failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private registerIpc(): void {
    if (this.ipcRegistered) return;
    this.ipcRegistered = true;

    ipcMain.handle(
      "desktop:libmpv-create",
      async (event, request: LibMpvPlayerRequest) => {
        if (!this.mainWindow || event.sender !== this.mainWindow.webContents) {
          return null;
        }
        await this.waitForStartupPreflight();
        return this.create(request.bounds);
      },
    );

    ipcMain.handle(
      "desktop:libmpv-resize",
      async (_event, playerId: string, bounds: LibMpvBounds) => {
        return this.resize(playerId, bounds);
      },
    );

    ipcMain.handle(
      "desktop:libmpv-load",
      async (_event, playerId: string, request: LibMpvSourceRequest) => {
        return this.load(playerId, request);
      },
    );

    ipcMain.handle(
      "desktop:libmpv-command",
      async (_event, playerId: string, command: LibMpvCommand) => {
        return this.command(playerId, command);
      },
    );

    ipcMain.handle(
      "desktop:libmpv-extract-audio",
      async (_event, request: LibMpvAudioRequest) => {
        await this.waitForStartupPreflight();
        return this.extractAudio(request);
      },
    );

    ipcMain.handle(
      "desktop:libmpv-reparent",
      async (_event, playerId: string, target: "main" | "pip") => {
        return this.reparent(playerId, target);
      },
    );

    ipcMain.handle(
      "desktop:libmpv-destroy",
      async (_event, playerId: string, reason?: string) => {
        return this.destroy(playerId, reason);
      },
    );
  }

  public create(bounds: LibMpvBounds): string | null {
    if (!this.addon || !this.mainWindow || this.mainWindow.isDestroyed()) {
      this.broadcastError("native_addon_unavailable");
      return null;
    }

    const normalizedBounds = normalizeBounds(
      bounds,
      getNativeScaleFactor(this.mainWindow),
    );
    try {
      const id = this.addon.createPlayer(
        this.mainWindow.getNativeWindowHandle(),
        normalizedBounds,
        (event) => this.handleNativeEvent(event),
      );
      this.players.set(id, {
        id,
        generation: 0,
        bounds: normalizedBounds,
        target: "main",
      });
      this.broadcastLog("info", "create", {
        playerId: id,
        bounds: normalizedBounds,
      });
      return id;
    } catch (error) {
      this.broadcastError(
        "create_failed",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  public resize(playerId: string, bounds: LibMpvBounds): boolean {
    const player = this.players.get(playerId);
    if (!player || !this.addon || !this.mainWindow) return false;

    player.bounds = normalizeBounds(
      bounds,
      getNativeScaleFactor(this.mainWindow),
    );
    if (player.target === "pip") return true;

    try {
      this.addon.resizePlayer(playerId, player.bounds);
      this.broadcastLog("debug", "surface_bounds", {
        playerId,
        bounds: player.bounds,
      });
      return true;
    } catch (error) {
      this.broadcastError(
        "resize_failed",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  public load(playerId: string, request: LibMpvSourceRequest): boolean {
    const player = this.players.get(playerId);
    if (!player || !this.addon) return false;

    const requestedGeneration = request.generation;
    let generation: number;
    if (
      typeof requestedGeneration === "number" &&
      Number.isInteger(requestedGeneration) &&
      requestedGeneration >= 0
    ) {
      // Trust the renderer's generation. It tags its load requests so filtered
      // events stay in sync even when an earlier load is coalesced away.
      player.generation = requestedGeneration;
      generation = requestedGeneration;
    } else {
      player.generation += 1;
      generation = player.generation;
    }
    player.loadStartedAtMs = Date.now();
    player.isTorrent = request.isTorrent === true;
    const oldTimer = this.eventTimers.get(playerId);
    if (oldTimer) clearTimeout(oldTimer);

    this.broadcastLog("info", "load_requested", {
      playerId,
      generation,
      type: request.type,
      url: redactUrl(request.url),
      wallClockMs: Date.now(),
      loadElapsedMs: 0,
      isTorrent: player.isTorrent,
      timingPhase: "libmpv_load",
    });

    try {
      this.addon.loadPlayer(playerId, {
        ...request,
        generation,
        startAt: Math.max(0, Number(request.startAt) || 0),
        autoplay: request.autoplay !== false,
      });

      const timeoutMs = request.isTorrent
        ? TORRENT_NATIVE_EVENT_TIMEOUT_MS
        : request.type === "file"
          ? FILE_NATIVE_EVENT_TIMEOUT_MS
          : DEFAULT_NATIVE_EVENT_TIMEOUT_MS;
      const timeout = setTimeout(() => {
        if (this.players.get(playerId)?.generation !== generation) return;
        this.eventTimers.delete(playerId);
        this.broadcastError(
          "load_timeout",
          `libmpv load timed out after ${timeoutMs}ms`,
          {
            playerId,
            generation,
          },
        );
      }, timeoutMs);
      this.eventTimers.set(playerId, timeout);
      return true;
    } catch (error) {
      this.broadcastError(
        "load_failed",
        error instanceof Error ? error.message : String(error),
        { playerId, generation },
      );
      return false;
    }
  }

  public command(playerId: string, command: LibMpvCommand): boolean {
    const player = this.players.get(playerId);
    if (!player || !this.addon) return false;

    try {
      this.addon.commandPlayer(playerId, command);
      this.broadcastLog("debug", command.type, {
        playerId,
        generation: player.generation,
      });
      return true;
    } catch (error) {
      this.broadcastError(
        "command_failed",
        error instanceof Error ? error.message : String(error),
        { playerId, generation: player.generation, command: command.type },
      );
      return false;
    }
  }

  public async extractAudio(request: LibMpvAudioRequest): Promise<Uint8Array> {
    if (!this.addon) {
      throw new Error("Native libmpv addon is unavailable");
    }
    if (
      !request ||
      typeof request.url !== "string" ||
      request.url.length === 0 ||
      !Number.isFinite(request.startAt) ||
      !Number.isFinite(request.duration) ||
      request.duration <= 0
    ) {
      throw new Error("Invalid libmpv audio extraction request");
    }

    const outputPath = path.join(
      app.getPath("temp"),
      `framezoo-audio-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`,
    );
    try {
      await this.addon.extractAudio({
        ...request,
        startAt: Math.max(0, request.startAt),
        duration: Math.min(60, Math.max(1, request.duration)),
        outputPath,
      });
      return new Uint8Array(await fs.promises.readFile(outputPath));
    } finally {
      await fs.promises.rm(outputPath, { force: true }).catch(() => {});
    }
  }

  public reparent(playerId: string, target: "main" | "pip"): boolean {
    const player = this.players.get(playerId);
    if (!player || !this.addon) return false;

    const parentWindow =
      target === "pip" ? this.pipWindowProvider?.() : this.mainWindow;
    if (!parentWindow || parentWindow.isDestroyed()) return false;

    if (player.pipResizeListener && player.pipWindow) {
      player.pipWindow.off("resize", player.pipResizeListener);
      player.pipResizeListener = undefined;
      player.pipWindow = undefined;
    }

    player.target = target;

    try {
      this.addon.reparentPlayer(playerId, parentWindow.getNativeWindowHandle());
      if (target === "pip") {
        const resizePip = () => {
          if (player.target !== "pip" || parentWindow.isDestroyed()) return;
          const contentBounds = parentWindow.getContentBounds();
          try {
            this.addon!.resizePlayer(
              playerId,
              normalizeBounds(
                {
                  x: 0,
                  y: 0,
                  width: Math.max(1, contentBounds.width),
                  height: Math.max(1, contentBounds.height),
                },
                getNativeScaleFactor(parentWindow),
              ),
            );
          } catch {}
        };
        resizePip();
        parentWindow.on("resize", resizePip);
        player.pipResizeListener = resizePip;
        player.pipWindow = parentWindow;
      } else {
        this.addon.resizePlayer(playerId, player.bounds);
      }
      this.broadcastLog("info", "reparent", {
        playerId,
        generation: player.generation,
        target,
      });
      return true;
    } catch (error) {
      this.broadcastError(
        "reparent_failed",
        error instanceof Error ? error.message : String(error),
        { playerId, target },
      );
      return false;
    }
  }

  public destroy(playerId: string, reason = "ipc:destroy"): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    if (player.pipResizeListener && player.pipWindow) {
      player.pipWindow.off("resize", player.pipResizeListener);
      player.pipResizeListener = undefined;
      player.pipWindow = undefined;
    }

    this.players.delete(playerId);
    const timer = this.eventTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.eventTimers.delete(playerId);

    try {
      this.addon?.destroyPlayer(playerId);
    } catch (error) {
      this.broadcastError(
        "destroy_failed",
        error instanceof Error ? error.message : String(error),
        { playerId, reason },
      );
    } finally {
      this.players.delete(playerId);
      this.broadcastLog("info", "destroy", { playerId, reason });
    }

    return true;
  }

  public destroyAll(reason = "controller:destroy-all"): void {
    for (const playerId of [...this.players.keys()]) {
      this.destroy(playerId, reason);
    }
  }

  private handleNativeEvent(event: NativePlayerEvent): void {
    const playerId = event.playerId;
    const player = this.players.get(playerId);
    if (!player || event.generation !== player.generation) return;

    if (
      event.type === "error" ||
      event.type === "end-file" ||
      event.type === "video-frame"
    ) {
      const timer = this.eventTimers.get(playerId);
      if (timer) clearTimeout(timer);
      this.eventTimers.delete(playerId);
    }

    const eventData = {
      playerId,
      playbackId: playerId,
      generation: event.generation,
      message: redactLogMessage(event.message),
      wallClockMs: Date.now(),
      loadElapsedMs: player.loadStartedAtMs
        ? Date.now() - player.loadStartedAtMs
        : undefined,
      isTorrent: player.isTorrent === true,
    };

    if (event.type === "log") {
      this.broadcastLog(event.level ?? "info", "mpv", eventData);
    } else if (event.type === "file-loaded") {
      this.broadcastLog("info", "file_loaded", {
        ...eventData,
        timingPhase: "file_loaded",
      });
    } else if (event.type === "video-reconfig") {
      this.broadcastLog("debug", "video_reconfig", eventData);
    } else if (event.type === "video-frame") {
      this.broadcastLog("debug", "video_frame", {
        ...eventData,
        timingPhase: "video_frame",
      });
    } else if (event.type === "end-file") {
      this.broadcastLog("info", "end_file", eventData);
    } else if (event.type === "error") {
      this.broadcastLog("error", "error", eventData);
    } else if (event.type === "property") {
      if (event.name === "pause" && typeof event.data === "boolean") {
        this.broadcastLog(
          event.data ? "info" : "info",
          event.data ? "pause" : "play",
          eventData,
        );
      } else if (event.name === "seeking" && event.data === true) {
        this.broadcastLog("debug", "seek", eventData);
      } else if (event.name === "paused-for-cache" && event.data === true) {
        this.broadcastLog("debug", "buffering", eventData);
      } else if (
        event.name === "duration" ||
        event.name === "track-list" ||
        event.name === "video-params" ||
        event.name === "video-out-params" ||
        event.name === "pause" ||
        event.name === "seeking" ||
        event.name === "paused-for-cache"
      ) {
        this.broadcastLog("debug", "property", {
          ...eventData,
          name: event.name,
          value:
            event.name === "track-list"
              ? "[track-list]"
              : typeof event.data === "number"
                ? event.data
                : event.data,
        });
      }
    }

    this.sendToRenderer({
      ...event,
      playerId,
      playbackId: playerId,
      message: redactLogMessage(event.message),
    });
  }

  private sendToRenderer(event: LibMpvPlayerEvent): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send("desktop:libmpv-event", event);
  }

  private broadcastLog(
    level: string,
    name: string,
    data?: Record<string, unknown>,
  ): void {
    const enrichedData = data?.playerId
      ? { ...data, playbackId: data.playbackId ?? data.playerId }
      : data;
    console.log(`[libmpv] ${name}`, { level, ...enrichedData });
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send("desktop:libmpv-log", {
      level,
      name,
      data: enrichedData,
    });
  }

  private broadcastError(
    name: string,
    message?: string,
    data?: Record<string, unknown>,
  ): void {
    console.error(`[libmpv] ${name}`, { message, ...data });
    this.sendToRenderer({
      playerId: String(data?.playerId ?? ""),
      generation: Number(data?.generation ?? 0),
      type: "error",
      name,
      message,
    });
  }
}

export const libmpvController = new LibMpvController();
