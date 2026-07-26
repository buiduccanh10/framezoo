import { app, BrowserWindow, ipcMain } from "electron";
import { spawn, ChildProcess } from "node:child_process";
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

    this.ipcSocketPath = this.getSocketPath();
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
      this.mpvProcess = spawn(mpvBin, mpvArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.mpvProcess.stderr?.on("data", (data) => {
        const msg = data.toString("utf8").trim();
        if (msg) console.log(`[embedded-mpv] ${msg}`);
      });

      this.mpvProcess.on("error", (err) => {
        console.error("[embedded-mpv] Failed to spawn mpv:", err);
      });

      this.mpvProcess.on("exit", (code) => {
        console.log(`[embedded-mpv] mpv exited with code ${code}`);
        this.cleanupSocket();
      });

      // Connect socket after brief delay for MPV IPC initialization
      setTimeout(() => {
        this.connectSocket();
      }, 300);

      return true;
    } catch (err) {
      console.error("[embedded-mpv] Error attaching MPV:", err);
      this.detach();
      return false;
    }
  }

  private connectSocket(retries = 15, delay = 200): void {
    if (!this.ipcSocketPath || this.socket) return;

    const socketPath = this.ipcSocketPath;
    const client = net.connect(socketPath, () => {
      this.socket = client;
      console.log("[embedded-mpv] Connected to MPV IPC socket");
      // Observe key properties for UI sync
      this.sendCommand("observe_property", [1, "time-pos"]);
      this.sendCommand("observe_property", [2, "duration"]);
      this.sendCommand("observe_property", [3, "pause"]);
      this.sendCommand("observe_property", [4, "volume"]);
      this.sendCommand("observe_property", [5, "paused-for-cache"]);
      this.sendCommand("observe_property", [6, "seeking"]);
      this.sendCommand("observe_property", [7, "cache-buffering-state"]);
    });

    client.on("data", (data) => {
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
      if (this.socket) return;
      if (retries > 0 && (err.code === "ENOENT" || err.code === "ECONNREFUSED")) {
        setTimeout(() => {
          this.connectSocket(retries - 1, delay);
        }, delay);
      } else {
        console.warn("[embedded-mpv] Socket error:", err.message);
      }
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

    if (!this.socket || this.socket.destroyed) {
      this.connectSocket();
    }

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

    this.cleanupSocket();
    this.currentUrl = null;
    this.lastBounds = null;
    this.buffer = "";
  }

  private cleanupSocket(): void {
    if (
      this.ipcSocketPath &&
      process.platform !== "win32" &&
      fs.existsSync(this.ipcSocketPath)
    ) {
      try {
        fs.unlinkSync(this.ipcSocketPath);
      } catch {
        // ignore
      }
    }
  }
}

export const embeddedMpv = new EmbeddedMpvController();
