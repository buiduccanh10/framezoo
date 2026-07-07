import { BrowserWindow, shell } from "electron";
import { pathToFileURL } from "node:url";
import type {
  CreateDesktopPipControllerOptions,
  DesktopPipState,
} from "./types";

export function createDesktopPipController(
  options: CreateDesktopPipControllerOptions,
) {
  let pipWindow: BrowserWindow | null = null;
  let pipState: DesktopPipState = null;

  function getPipUrl() {
    if (options.rendererDevUrl) {
      return `${options.rendererDevUrl.replace(/\/$/, "")}/#${options.desktopPipRoute}`;
    }

    return `${pathToFileURL(options.rendererEntryPath).toString()}#${options.desktopPipRoute}`;
  }

  function sendState() {
    if (!pipWindow || pipWindow.isDestroyed() || !pipState) {
      return;
    }

    pipWindow.webContents.send("desktop:pip-state", pipState);
  }

  function createWindow() {
    if (pipWindow && !pipWindow.isDestroyed()) {
      return pipWindow;
    }

    pipWindow = new BrowserWindow({
      width: 420,
      height: 236,
      minWidth: 320,
      minHeight: 180,
      maxWidth: 1280,
      maxHeight: 720,
      backgroundColor: "#000000",
      alwaysOnTop: true,
      frame: false,
      resizable: true,
      skipTaskbar: true,
      autoHideMenuBar: true,
      show: false,
      fullscreenable: false,
      webPreferences: {
        preload: options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: false,
        devTools: options.enableDevTools,
        backgroundThrottling: false,
      },
    });

    pipWindow.setAlwaysOnTop(true, "screen-saver");
    pipWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    pipWindow.setAspectRatio(16 / 9);
    pipWindow.setWindowButtonVisibility(false);

    pipWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        void shell.openExternal(url);
        return { action: "deny" };
      }

      return { action: "allow" };
    });

    pipWindow.webContents.on("will-navigate", (event, url) => {
      const currentUrl = pipWindow?.webContents.getURL();
      if (url !== currentUrl && /^https?:\/\//i.test(url)) {
        event.preventDefault();
        void shell.openExternal(url);
      }
    });

    pipWindow.webContents.on("did-finish-load", () => {
      sendState();
    });

    pipWindow.once("ready-to-show", () => {
      pipWindow?.show();
    });

    pipWindow.on("closed", () => {
      pipWindow = null;
      pipState = null;
      options.onClosed?.();
    });

    void pipWindow.loadURL(getPipUrl());

    return pipWindow;
  }

  return {
    close() {
      pipState = null;

      if (!pipWindow || pipWindow.isDestroyed()) {
        return false;
      }

      pipWindow.close();
      return true;
    },
    getState() {
      return pipState;
    },
    open(nextState: DesktopPipState) {
      pipState = nextState ?? null;
      if (!pipState) return false;

      const window = createWindow();
      sendState();

      if (window.isMinimized()) {
        window.restore();
      }

      if (typeof window.showInactive === "function") {
        window.showInactive();
      } else {
        window.show();
      }

      return true;
    },
    update(nextState: DesktopPipState) {
      pipState = nextState ?? null;
      sendState();
      return Boolean(pipWindow && !pipWindow.isDestroyed());
    },
  };
}
