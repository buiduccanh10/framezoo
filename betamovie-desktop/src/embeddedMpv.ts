import { app, BrowserWindow, ipcMain } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

export interface MpvBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class EmbeddedMpvController {
  private mainWindow: BrowserWindow | null = null;
  private mpvWindow: BrowserWindow | null = null;
  private mpvProcess: ChildProcess | null = null;
  private ipcSocketPath: string = "";
  private socket: net.Socket | null = null;
  private currentUrl: string | null = null;
  private lastBounds: MpvBounds | null = null;
  private buffer: string = "";
  private connectionGeneration = 0;

  constructor() {}

  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    this.setupIpc();
    this.setupWindowListeners();
  }

  private setupWindowListeners(): void {
    if (!this.mainWindow) return;

    this.mainWindow.on("move", () => {
      if (this.lastBounds) this.updateBounds(this.lastBounds);
    });

    this.mainWindow.on("resize", () => {
      if (this.lastBounds) this.updateBounds(this.lastBounds);
    });

    this.mainWindow.on("minimize", () => {
      if (this.mpvWindow && !this.mpvWindow.isDestroyed()) {
        this.mpvWindow.hide();
      }
    });

    this.mainWindow.on("restore", () => {
      if (this.mpvWindow && !this.mpvWindow.isDestroyed()) {
        this.mpvWindow.show();
      }
    });

    this.mainWindow.on("closed", () => {
      this.detach();
    });
  }

  private setupIpc(): void {
    ipcMain.handle(
      "desktop:mpv-attach",
      async (_event, url: string, bounds: MpvBounds) => {
        return this.attach(url, bounds);
      },
    );

    ipcMain.handle(
      "desktop:mpv-update-bounds",
      async (_event, bounds: MpvBounds) => {
        this.updateBounds(bounds);
        return true;
      },
    );

    ipcMain.handle("desktop:mpv-detach", async () => {
      this.detach();
      return true;
    });

    ipcMain.handle(
      "desktop:mpv-command",
      async (_event, command: string, ...args: any[]) => {
        return this.sendCommand(command, args);
      },
    );
  }

  private getSocketPath(): string {
    const tmpDir = os.tmpdir();
    const id = Math.random().toString(36).substring(2, 9);
    if (process.platform === "win32") {
      return `\\\\.\\pipe\\betamovie-mpv-${id}`;
    }
    return path.join(tmpDir, `betamovie-mpv-${id}.sock`);
  }

  private getMpvBinaryPath(): string {
    if (process.env.MPV_PATH && fs.existsSync(process.env.MPV_PATH)) {
      return process.env.MPV_PATH;
    }

    const binName = process.platform === "win32" ? "mpv.exe" : "mpv";

    if (app && app.isPackaged) {
      const packagedPath = path.join(process.resourcesPath, "bin", binName);
      if (fs.existsSync(packagedPath)) {
        return packagedPath;
      }
    }

    const devResourcePath = path.join(
      process.cwd(),
      "resources",
      "bin",
      `${process.platform}-${process.arch}`,
      binName,
    );
    if (fs.existsSync(devResourcePath)) {
      return devResourcePath;
    }

    const candidatePaths: string[] = [];
    if (process.platform === "darwin") {
      candidatePaths.push(
        "/opt/homebrew/bin/mpv",
        "/usr/local/bin/mpv",
        "/Applications/mpv.app/Contents/MacOS/mpv",
      );
    } else if (process.platform === "win32") {
      candidatePaths.push(
        "C:\\Program Files\\mpv\\mpv.exe",
        "C:\\mpv\\mpv.exe",
      );
    } else {
      candidatePaths.push(
        "/usr/bin/mpv",
        "/usr/local/bin/mpv",
        "/snap/bin/mpv",
      );
    }

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return process.env.MPV_PATH || "mpv";
  }

  public async attach(url: string, bounds: MpvBounds): Promise<boolean> {
    this.detach();

    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return false;
    }

    this.currentUrl = url;
    this.lastBounds = bounds;

    const windowBounds = this.mainWindow.getContentBounds();
    const targetX = Math.round(windowBounds.x + bounds.x);
    const targetY = Math.round(windowBounds.y + bounds.y);
    const targetW = Math.max(10, Math.round(bounds.width));
    const targetH = Math.max(10, Math.round(bounds.height));

    const generation = this.connectionGeneration;
    const socketPath = this.getSocketPath();
    this.ipcSocketPath = socketPath;
    const mpvBin = this.getMpvBinaryPath();

    const geometry = `${targetW}x${targetH}+${targetX}+${targetY}`;

    const mpvArgs = [
      `--input-ipc-server=${this.ipcSocketPath}`,
      "--no-border",
      "--no-osc",
      "--no-osd-bar",
      "--no-input-default-bindings",
      "--idle=yes",
      "--keep-open=yes",
      "--force-window=yes",
      "--hwdec=auto",
      "--vo=gpu",
      "--ytdl=no",
      `--geometry=${geometry}`,
      `--autofit=${targetW}x${targetH}`,
      "--ontop",
    ];

    if (process.platform === "win32" || process.platform === "linux") {
      this.mpvWindow = new BrowserWindow({
        parent: this.mainWindow,
        x: targetX,
        y: targetY,
        width: targetW,
        height: targetH,
        frame: false,
        hasShadow: false,
        transparent: false,
        show: true,
        useContentSize: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: false,
        backgroundColor: "#000000",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      this.mpvWindow.setIgnoreMouseEvents(true, { forward: true });
      const handle = this.mpvWindow.getNativeWindowHandle();
      const wid =
        process.platform === "win32"
          ? handle.readInt32LE()
          : handle.readUInt32LE();
      mpvArgs.unshift(`--wid=${wid}`);
    } else if (process.platform === "darwin") {
      mpvArgs.push("--macos-app-activation-policy=accessory");
    }

    mpvArgs.push(url);

    try {
      const process = spawn(mpvBin, mpvArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.mpvProcess = process;

      process.stderr?.on("data", (data) => {
        const msg = data.toString("utf8").trim();
        if (msg) console.log(`[embedded-mpv] ${msg}`);
      });

      process.on("error", (err) => {
        if (this.mpvProcess !== process) return;
        console.error("[embedded-mpv] Failed to spawn mpv:", {
          error: err,
          url,
        });
      });

      process.on("exit", (code, signal) => {
        const isCurrentProcess = this.mpvProcess === process;
        console.log("[embedded-mpv] mpv exited", {
          code,
          signal,
          isCurrentProcess,
          url,
        });
        this.cleanupSocket(socketPath);
        if (!isCurrentProcess) return;

        this.mpvProcess = null;
        if (this.socket) {
          this.socket.destroy();
          this.socket = null;
        }
      });

      console.log("[embedded-mpv] spawning mpv", {
        generation,
        socketPath,
        url,
      });

      // Connect socket after brief delay for MPV IPC initialization
      setTimeout(() => {
        this.connectSocket(generation, socketPath, process);
      }, 300);

      return true;
    } catch (err) {
      console.error("[embedded-mpv] Error attaching MPV:", err);
      this.detach();
      return false;
    }
  }

  private connectSocket(
    generation: number,
    socketPath: string,
    process: ChildProcess,
    retries = 15,
    delay = 200,
  ): void {
    if (
      generation !== this.connectionGeneration ||
      this.mpvProcess !== process ||
      this.socket ||
      !socketPath
    ) {
      return;
    }

    const client = net.connect(socketPath, () => {
      if (
        generation !== this.connectionGeneration ||
        this.mpvProcess !== process
      ) {
        client.destroy();
        return;
      }

      this.socket = client;
      console.log("[embedded-mpv] connected to IPC socket", {
        generation,
        socketPath,
      });
      // Observe key properties for UI sync
      this.sendCommand("observe_property", [1, "time-pos"]);
      this.sendCommand("observe_property", [2, "duration"]);
      this.sendCommand("observe_property", [3, "pause"]);
      this.sendCommand("observe_property", [4, "volume"]);
      this.sendCommand("observe_property", [5, "paused-for-cache"]);
      this.sendCommand("observe_property", [6, "seeking"]);
      this.sendCommand("observe_property", [7, "cache-buffering-state"]);
      this.sendCommand("set_property", ["pause", false]);
    });

    client.on("data", (data) => {
      if (
        generation !== this.connectionGeneration ||
        this.mpvProcess !== process ||
        this.socket !== client
      ) {
        client.destroy();
        return;
      }

      this.buffer += data.toString("utf8");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (
            msg.event === "property-change" &&
            this.mainWindow &&
            !this.mainWindow.isDestroyed()
          ) {
            this.mainWindow.webContents.send("desktop:mpv-status", {
              name: msg.name,
              data: msg.data,
            });
          }
        } catch {
          // ignore JSON parse errors
        }
      }
    });

    client.on("error", (err: any) => {
      if (
        generation !== this.connectionGeneration ||
        this.mpvProcess !== process
      ) {
        return;
      }
      if (
        retries > 0 &&
        (err.code === "ENOENT" || err.code === "ECONNREFUSED")
      ) {
        console.debug("[embedded-mpv] IPC socket not ready; retrying", {
          retries,
          error: err.code,
          socketPath,
        });
        setTimeout(() => {
          this.connectSocket(
            generation,
            socketPath,
            process,
            retries - 1,
            delay,
          );
        }, delay);
      } else {
        console.warn("[embedded-mpv] IPC socket error", {
          error: err.message,
          socketPath,
        });
      }
    });

    client.on("close", () => {
      if (
        generation !== this.connectionGeneration ||
        this.mpvProcess !== process ||
        this.socket !== client
      ) {
        return;
      }
      this.socket = null;
      console.warn("[embedded-mpv] IPC socket closed", { socketPath });
    });
  }

  public updateBounds(bounds: MpvBounds): void {
    this.lastBounds = bounds;

    if (!this.mpvWindow || this.mpvWindow.isDestroyed() || !this.mainWindow) {
      return;
    }

    const windowBounds = this.mainWindow.getContentBounds();
    const targetX = Math.round(windowBounds.x + bounds.x);
    const targetY = Math.round(windowBounds.y + bounds.y);
    const targetW = Math.max(10, Math.round(bounds.width));
    const targetH = Math.max(10, Math.round(bounds.height));

    this.mpvWindow.setBounds({
      x: targetX,
      y: targetY,
      width: targetW,
      height: targetH,
    });
  }

  public sendCommand(cmd: string, args: any[]): boolean {
    if (!this.ipcSocketPath) return false;

    if (!this.socket || this.socket.destroyed) return false;

    const commandObj = { command: [cmd, ...args] };
    try {
      this.socket.write(JSON.stringify(commandObj) + "\n");
      return true;
    } catch (err) {
      console.error("[embedded-mpv] Failed to send command:", err);
      return false;
    }
  }

  public detach(): void {
    this.connectionGeneration += 1;
    const socketPath = this.ipcSocketPath;

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    if (this.mpvProcess) {
      try {
        this.mpvProcess.kill("SIGKILL");
      } catch {
        // ignore
      }
      this.mpvProcess = null;
    }

    if (this.mpvWindow && !this.mpvWindow.isDestroyed()) {
      this.mpvWindow.close();
      this.mpvWindow = null;
    }

    this.cleanupSocket(socketPath);
    this.ipcSocketPath = "";
    this.currentUrl = null;
    this.lastBounds = null;
    this.buffer = "";
  }

  private cleanupSocket(socketPath: string): void {
    if (
      socketPath &&
      process.platform !== "win32" &&
      fs.existsSync(socketPath)
    ) {
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // ignore
      }
    }
  }
}

export const embeddedMpv = new EmbeddedMpvController();
