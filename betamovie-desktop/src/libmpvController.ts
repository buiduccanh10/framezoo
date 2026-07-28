import { app, BrowserWindow, ipcMain, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import type {
  LibMpvBounds,
  LibMpvCommand,
  LibMpvPlayerEvent,
  LibMpvPlayerRequest,
  LibMpvSourceRequest,
} from "./types";

type NativePlayerEvent = LibMpvPlayerEvent;

interface NativeLibMpvAddon {
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
  destroyPlayer(playerId: string): void;
}

type PlayerRecord = {
  id: string;
  generation: number;
  bounds: LibMpvBounds;
};

const DEFAULT_NATIVE_EVENT_TIMEOUT_MS = 120_000;

function isSupportedDesktopPlatform(): boolean {
  return process.platform === "darwin" || process.platform === "win32";
}

function getNativeAddonCandidates(): string[] {
  const target = `${process.platform}-${process.arch}`;
  const candidates = [
    process.env.BETAMOVIE_LIBMPV_ADDON,
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
  if (process.env.BETAMOVIE_LIBMPV_PATH) return;

  const target = `${process.platform}-${process.arch}`;
  const runtimeName =
    process.platform === "win32" ? "libmpv-2.dll" : "libmpv.2.dylib";
  const candidates = [
    app.isPackaged
      ? path.join(process.resourcesPath, "libmpv", runtimeName)
      : null,
    path.join(process.cwd(), "resources", "libmpv", target, runtimeName),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const runtimePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (runtimePath) process.env.BETAMOVIE_LIBMPV_PATH = runtimePath;
}

function getNativeAddon(): NativeLibMpvAddon | null {
  if (!isSupportedDesktopPlatform()) return null;

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

  public init(
    mainWindow: BrowserWindow,
    pipWindowProvider?: () => BrowserWindow | null,
  ): void {
    this.mainWindow = mainWindow;
    this.pipWindowProvider = pipWindowProvider ?? null;
    configureNativeRuntime();
    this.addon = getNativeAddon();

    if (!this.addon) {
      console.warn("[libmpv] native addon unavailable", {
        platform: process.platform,
        arch: process.arch,
        candidates: getNativeAddonCandidates(),
      });
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

  private registerIpc(): void {
    if (this.ipcRegistered) return;
    this.ipcRegistered = true;

    ipcMain.handle(
      "desktop:libmpv-create",
      async (event, request: LibMpvPlayerRequest) => {
        if (!this.mainWindow || event.sender !== this.mainWindow.webContents) {
          return null;
        }
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
      "desktop:libmpv-reparent",
      async (_event, playerId: string, target: "main" | "pip") => {
        return this.reparent(playerId, target);
      },
    );

    ipcMain.handle(
      "desktop:libmpv-destroy",
      async (_event, playerId: string) => {
        return this.destroy(playerId);
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

    player.generation += 1;
    const generation = player.generation;
    const oldTimer = this.eventTimers.get(playerId);
    if (oldTimer) clearTimeout(oldTimer);

    this.broadcastLog("info", "load_requested", {
      playerId,
      generation,
      type: request.type,
      url: redactUrl(request.url),
    });

    try {
      this.addon.loadPlayer(playerId, {
        ...request,
        generation,
        startAt: Math.max(0, Number(request.startAt) || 0),
      });

      const timeout = setTimeout(() => {
        if (this.players.get(playerId)?.generation !== generation) return;
        this.eventTimers.delete(playerId);
        this.broadcastError(
          "load_timeout",
          `libmpv load timed out after ${DEFAULT_NATIVE_EVENT_TIMEOUT_MS}ms`,
          {
            playerId,
            generation,
          },
        );
      }, DEFAULT_NATIVE_EVENT_TIMEOUT_MS);
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

  public reparent(playerId: string, target: "main" | "pip"): boolean {
    const player = this.players.get(playerId);
    if (!player || !this.addon) return false;

    const parentWindow =
      target === "pip" ? this.pipWindowProvider?.() : this.mainWindow;
    if (!parentWindow || parentWindow.isDestroyed()) return false;

    try {
      this.addon.reparentPlayer(playerId, parentWindow.getNativeWindowHandle());
      if (target === "pip") {
        const contentBounds = parentWindow.getContentBounds();
        this.addon.resizePlayer(
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

  public destroy(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    const timer = this.eventTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.eventTimers.delete(playerId);

    try {
      this.addon?.destroyPlayer(playerId);
    } catch (error) {
      this.broadcastError(
        "destroy_failed",
        error instanceof Error ? error.message : String(error),
        { playerId },
      );
    } finally {
      this.players.delete(playerId);
      this.broadcastLog("info", "destroy", { playerId });
    }

    return true;
  }

  public destroyAll(): void {
    for (const playerId of [...this.players.keys()]) {
      this.destroy(playerId);
    }
  }

  private handleNativeEvent(event: NativePlayerEvent): void {
    const playerId = event.playerId;
    const player = this.players.get(playerId);
    if (!player || event.generation !== player.generation) return;

    if (
      event.type === "file-loaded" ||
      event.type === "error" ||
      event.type === "end-file"
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
    };

    if (event.type === "log") {
      this.broadcastLog(event.level ?? "info", "mpv", eventData);
    } else if (event.type === "file-loaded") {
      this.broadcastLog("info", "file_loaded", eventData);
    } else if (event.type === "video-reconfig") {
      this.broadcastLog("debug", "video_reconfig", eventData);
    } else if (event.type === "video-frame") {
      this.broadcastLog("debug", "video_frame", eventData);
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
