import { contextBridge, ipcRenderer } from "electron";
import type {
  TorrentSession,
  TorrentStartRequest,
  TorrentStatus,
} from "./types";

type RuntimeConfig = Record<string, string>;

const runtimeConfig: RuntimeConfig = {
  VITE_BACKEND_URL: "http://127.0.0.1:3000",
  VITE_NORMAL_ROUTER: "false",
};
const supportsEmbeddedMpv = true;

if (process.env.BETAMOVIE_BACKEND_URL || process.env.VITE_BACKEND_URL) {
  runtimeConfig.VITE_BACKEND_URL =
    process.env.BETAMOVIE_BACKEND_URL ??
    process.env.VITE_BACKEND_URL ??
    runtimeConfig.VITE_BACKEND_URL;
}

contextBridge.exposeInMainWorld("__CONFIG__", runtimeConfig);

contextBridge.exposeInMainWorld("__ALPHAFLIX_DESKTOP__", true);

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
  onAppUpdateState(listener: (state: unknown) => void) {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => {
      listener(state);
    };
    ipcRenderer.on("desktop:app-update-state", handler);
    return () => {
      ipcRenderer.removeListener("desktop:app-update-state", handler);
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
  ...(supportsEmbeddedMpv
    ? {
        attachMpvPlayer(
          url: string,
          bounds: { x: number; y: number; width: number; height: number },
        ) {
          return ipcRenderer.invoke("desktop:mpv-attach", url, bounds);
        },
        updateMpvBounds(bounds: {
          x: number;
          y: number;
          width: number;
          height: number;
        }) {
          return ipcRenderer.invoke("desktop:mpv-update-bounds", bounds);
        },
        detachMpvPlayer() {
          return ipcRenderer.invoke("desktop:mpv-detach");
        },
        sendMpvCommand(command: string, ...args: any[]) {
          return ipcRenderer.invoke("desktop:mpv-command", command, ...args);
        },
        onMpvStatus(listener: (status: { name: string; data: any }) => void) {
          const handler = (
            _event: Electron.IpcRendererEvent,
            status: { name: string; data: any },
          ) => {
            listener(status);
          };
          ipcRenderer.on("desktop:mpv-status", handler);
          return () => {
            ipcRenderer.removeListener("desktop:mpv-status", handler);
          };
        },
      }
    : {}),
});

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.desktopApp = "true";
  document.body.dataset.desktopApp = "true";
});

window.addEventListener("alphaflix-desktop-settings", () => {
  void ipcRenderer.invoke("desktop:show-settings-placeholder");
});
