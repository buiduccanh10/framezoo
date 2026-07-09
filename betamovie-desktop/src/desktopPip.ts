import { BrowserWindow, shell } from "electron";
import { pathToFileURL } from "node:url";
import type {
  CreateDesktopPipControllerOptions,
  DesktopPipState,
  DesktopPipWindowSize,
} from "./types";

const DESKTOP_PIP_DEFAULT_WIDTH = 420;
const DESKTOP_PIP_DEFAULT_HEIGHT = 236;
const DESKTOP_PIP_MIN_WIDTH = 320;
const DESKTOP_PIP_MIN_HEIGHT = 180;
const DESKTOP_PIP_MAX_WIDTH = 1280;
const DESKTOP_PIP_MAX_HEIGHT = 720;

function normalizeWindowSize(
  value: DesktopPipWindowSize | null | undefined,
): DesktopPipWindowSize | null {
  if (!value) return null;

  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return {
    width: Math.round(
      Math.min(DESKTOP_PIP_MAX_WIDTH, Math.max(DESKTOP_PIP_MIN_WIDTH, width)),
    ),
    height: Math.round(
      Math.min(
        DESKTOP_PIP_MAX_HEIGHT,
        Math.max(DESKTOP_PIP_MIN_HEIGHT, height),
      ),
    ),
  };
}

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

  function createWindow(windowSize?: DesktopPipWindowSize | null) {
    if (pipWindow && !pipWindow.isDestroyed()) {
      return pipWindow;
    }

    const normalizedWindowSize = normalizeWindowSize(windowSize);

    pipWindow = new BrowserWindow({
      width: normalizedWindowSize?.width ?? DESKTOP_PIP_DEFAULT_WIDTH,
      height: normalizedWindowSize?.height ?? DESKTOP_PIP_DEFAULT_HEIGHT,
      minWidth: DESKTOP_PIP_MIN_WIDTH,
      minHeight: DESKTOP_PIP_MIN_HEIGHT,
      maxWidth: DESKTOP_PIP_MAX_WIDTH,
      maxHeight: DESKTOP_PIP_MAX_HEIGHT,
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
    open(
      nextState: DesktopPipState,
      nextWindowSize?: DesktopPipWindowSize | null,
    ) {
      pipState = nextState ?? null;
      if (!pipState) return false;

      const window = createWindow(nextWindowSize);
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
