import { contextBridge, ipcRenderer } from "electron";
import type {
  AddonProtocolRequest,
  AddonProtocolResponse,
} from "./addons/types";
import type {
  LibMpvBounds,
  LibMpvCommand,
  LibMpvAudioRequest,
  LibMpvPlayerEvent,
  LibMpvSourceRequest,
  TorrentSession,
  TorrentStartRequest,
  TorrentStatus,
} from "./types";

type RuntimeConfig = Record<string, string>;

const runtimeConfig: RuntimeConfig = {
  VITE_BACKEND_URL: "http://127.0.0.1:3000",
  VITE_ADDON_GUIDE_URL: "http://localhost:5173/#addon-guide",
  VITE_NORMAL_ROUTER: "false",
};
const supportsLibMpv =
  process.platform === "darwin" || process.platform === "win32";

if (process.env.FRAMEZOO_BACKEND_URL || process.env.VITE_BACKEND_URL) {
  runtimeConfig.VITE_BACKEND_URL =
    process.env.FRAMEZOO_BACKEND_URL ??
    process.env.VITE_BACKEND_URL ??
    runtimeConfig.VITE_BACKEND_URL;
}

if (process.env.FRAMEZOO_ADDON_GUIDE_URL || process.env.VITE_ADDON_GUIDE_URL) {
  runtimeConfig.VITE_ADDON_GUIDE_URL =
    process.env.FRAMEZOO_ADDON_GUIDE_URL ??
    process.env.VITE_ADDON_GUIDE_URL ??
    runtimeConfig.VITE_ADDON_GUIDE_URL;
}

contextBridge.exposeInMainWorld("__CONFIG__", runtimeConfig);

contextBridge.exposeInMainWorld("__FRAMEZOO_DESKTOP__", true);

contextBridge.exposeInMainWorld("electronAPI", {
  getAppUpdateState() {
    return ipcRenderer.invoke("desktop:app-update-get-state");
  },
  checkForAppUpdate() {
    return ipcRenderer.invoke("desktop:app-update-check");
  },
  downloadAppUpdate() {
    return ipcRenderer.invoke("desktop:app-update-download");
  },
  installAppUpdate() {
    return ipcRenderer.invoke("desktop:app-update-install");
  },
  sendExtensionMessage(name: string, payload?: unknown) {
    return ipcRenderer.invoke("desktop:extension-message", name, payload);
  },
  addons: {
    loadManifest(
      manifestUrl: string,
    ): Promise<AddonProtocolResponse> {
      return ipcRenderer.invoke("desktop:addon-manifest", manifestUrl);
    },
    request(
      request: AddonProtocolRequest,
    ): Promise<AddonProtocolResponse> {
      return ipcRenderer.invoke("desktop:addon-request", request);
    },
  },
  openExternal(url: string) {
    return ipcRenderer.invoke("desktop:open-external", url);
  },
  showDesktopSettingsPlaceholder() {
    return ipcRenderer.invoke("desktop:show-settings-placeholder");
  },
  openDesktopPipWindow(state: unknown, windowSize?: unknown) {
    return ipcRenderer.invoke("desktop:pip-open", state, windowSize);
  },
  updateDesktopPipWindow(state: unknown) {
    return ipcRenderer.invoke("desktop:pip-update", state);
  },
  closeDesktopPipWindow() {
    return ipcRenderer.invoke("desktop:pip-close");
  },
  getDesktopPipWindowState() {
    return ipcRenderer.invoke("desktop:pip-get-state");
  },
  focusMainWindow() {
    return ipcRenderer.invoke("desktop:focus-main-window");
  },
  sendDesktopPipAction(action: unknown) {
    return ipcRenderer.invoke("desktop:pip-action", action);
  },
  onDesktopPipState(listener: (state: unknown) => void) {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => {
      listener(state);
    };
    ipcRenderer.on("desktop:pip-state", handler);
    return () => {
      ipcRenderer.removeListener("desktop:pip-state", handler);
    };
  },
  onDesktopPipClosed(listener: () => void) {
    const handler = () => {
      listener();
    };
    ipcRenderer.on("desktop:pip-closed", handler);
    return () => {
      ipcRenderer.removeListener("desktop:pip-closed", handler);
    };
  },
  onDesktopPipAction(listener: (action: unknown) => void) {
    const handler = (_event: Electron.IpcRendererEvent, action: unknown) => {
      listener(action);
    };
    ipcRenderer.on("desktop:pip-action", handler);
    return () => {
      ipcRenderer.removeListener("desktop:pip-action", handler);
    };
  },
  onDeepLink(listener: (url: string) => void) {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => {
      listener(url);
    };
    ipcRenderer.on("desktop:deep-link", handler);
    return () => {
      ipcRenderer.removeListener("desktop:deep-link", handler);
    };
  },
  onAppUpdateState(listener: (state: unknown) => void) {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => {
      listener(state);
    };
    ipcRenderer.on("desktop:app-update-state", handler);
    return () => {
      ipcRenderer.removeListener("desktop:app-update-state", handler);
    };
  },
  toggleFullscreen(): Promise<void> {
    return ipcRenderer.invoke("desktop:toggle-fullscreen");
  },
  onFullscreenState(listener: (isFullscreen: boolean) => void) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      isFullscreen: boolean,
    ) => {
      listener(isFullscreen);
    };
    ipcRenderer.on("desktop:fullscreen-state", handler);
    return () => {
      ipcRenderer.removeListener("desktop:fullscreen-state", handler);
    };
  },
  startTorrent(request: TorrentStartRequest): Promise<TorrentSession> {
    return ipcRenderer.invoke("desktop:torrent-start", request);
  },
  stopTorrent(sessionId: string): Promise<boolean> {
    return ipcRenderer.invoke("desktop:torrent-stop", sessionId);
  },
  getTorrentStatus(sessionId: string): Promise<TorrentStatus | null> {
    return ipcRenderer.invoke("desktop:torrent-get-status", sessionId);
  },
  setTorrentMaxSize(size: string | null): Promise<boolean> {
    return ipcRenderer.invoke("desktop:set-torrent-max-size", size);
  },
  onTorrentStatus(listener: (status: TorrentStatus) => void) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: TorrentStatus,
    ) => {
      listener(status);
    };
    ipcRenderer.on("desktop:torrent-status", handler);
    return () => {
      ipcRenderer.removeListener("desktop:torrent-status", handler);
    };
  },
  ...(supportsLibMpv
    ? {
        createLibMpvPlayer(bounds: LibMpvBounds): Promise<string | null> {
          return ipcRenderer.invoke("desktop:libmpv-create", { bounds });
        },
        resizeLibMpvPlayer(
          playerId: string,
          bounds: LibMpvBounds,
        ): Promise<boolean> {
          return ipcRenderer.invoke("desktop:libmpv-resize", playerId, bounds);
        },
        loadLibMpvSource(
          playerId: string,
          request: LibMpvSourceRequest,
        ): Promise<boolean> {
          return ipcRenderer.invoke("desktop:libmpv-load", playerId, request);
        },
        sendLibMpvCommand(
          playerId: string,
          command: LibMpvCommand,
        ): Promise<boolean> {
          return ipcRenderer.invoke(
            "desktop:libmpv-command",
            playerId,
            command,
          );
        },
        extractLibMpvAudio(
          request: LibMpvAudioRequest,
        ): Promise<Uint8Array> {
          return ipcRenderer.invoke("desktop:libmpv-extract-audio", request);
        },
        reparentLibMpvPlayer(
          playerId: string,
          target: "main" | "pip",
        ): Promise<boolean> {
          return ipcRenderer.invoke(
            "desktop:libmpv-reparent",
            playerId,
            target,
          );
        },
        destroyLibMpvPlayer(
          playerId: string,
          reason?: string,
        ): Promise<boolean> {
          return ipcRenderer.invoke(
            "desktop:libmpv-destroy",
            playerId,
            reason,
          );
        },
        onLibMpvEvent(listener: (event: LibMpvPlayerEvent) => void) {
          const handler = (
            _event: Electron.IpcRendererEvent,
            event: LibMpvPlayerEvent,
          ) => {
            listener(event);
          };
          ipcRenderer.on("desktop:libmpv-event", handler);
          return () => {
            ipcRenderer.removeListener("desktop:libmpv-event", handler);
          };
        },
        onLibMpvLog(listener: (log: unknown) => void) {
          const handler = (_event: Electron.IpcRendererEvent, log: unknown) => {
            listener(log);
          };
          ipcRenderer.on("desktop:libmpv-log", handler);
          return () => {
            ipcRenderer.removeListener("desktop:libmpv-log", handler);
          };
        },
      }
    : {}),
});

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.desktopApp = "true";
  document.body.dataset.desktopApp = "true";
});

window.addEventListener("framezoo-desktop-settings", () => {
  void ipcRenderer.invoke("desktop:show-settings-placeholder");
});
