import { BrowserWindow, screen, shell, type Rectangle } from "electron";
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
const DESKTOP_PIP_READY_TIMEOUT_MS = 30_000;
const DESKTOP_PIP_CORNER_MARGIN = 16;

function getNearestCornerPosition(
  bounds: Rectangle,
  workArea: Rectangle,
): Pick<Rectangle, "x" | "y"> {
  const left = workArea.x + DESKTOP_PIP_CORNER_MARGIN;
  const top = workArea.y + DESKTOP_PIP_CORNER_MARGIN;
  const right = Math.max(
    left,
    workArea.x + workArea.width - bounds.width - DESKTOP_PIP_CORNER_MARGIN,
  );
  const bottom = Math.max(
    top,
    workArea.y + workArea.height - bounds.height - DESKTOP_PIP_CORNER_MARGIN,
  );
  const positions = [
    { x: left, y: top },
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom },
  ];
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  return positions.reduce((nearest, position) => {
    const nearestDistance = Math.hypot(
      centerX - (nearest.x + bounds.width / 2),
      centerY - (nearest.y + bounds.height / 2),
    );
    const positionDistance = Math.hypot(
      centerX - (position.x + bounds.width / 2),
      centerY - (position.y + bounds.height / 2),
    );
    return positionDistance < nearestDistance ? position : nearest;
  });
}

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
  let pipReady = false;
  let readyPromise: Promise<boolean> | null = null;
  let resolveReady: ((ready: boolean) => void) | null = null;
  let readyTimeout: ReturnType<typeof setTimeout> | null = null;
  let closePromise: Promise<boolean> | null = null;

  function snapPipWindowToCorner(animate = true) {
    if (!pipWindow || pipWindow.isDestroyed()) return;

    const bounds = pipWindow.getBounds();
    const workArea = screen.getDisplayNearestPoint({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    }).workArea;
    const position = getNearestCornerPosition(bounds, workArea);
    if (position.x === bounds.x && position.y === bounds.y) return;

    pipWindow.setPosition(position.x, position.y, animate);
  }

  function getPipUrl() {
    if (options.rendererDevUrl) {
      return `${options.rendererDevUrl.replace(/\/$/, "")}/#${options.desktopPipRoute}`;
    }

    if (options.rendererAppUrl) {
      return `${options.rendererAppUrl}#${options.desktopPipRoute}`;
    }

    return `${pathToFileURL(options.rendererEntryPath).toString()}#${options.desktopPipRoute}`;
  }

  function isAllowedPipUrl(url: string) {
    const allowedUrl =
      options.rendererDevUrl ??
      options.rendererAppUrl ??
      pathToFileURL(options.rendererEntryPath).toString();
    try {
      const current = new URL(url);
      const allowed = new URL(allowedUrl);
      return (
        current.protocol === allowed.protocol && current.host === allowed.host
      );
    } catch {
      return false;
    }
  }

  function sendState() {
    if (!pipWindow || pipWindow.isDestroyed() || !pipState) {
      return;
    }

    pipWindow.webContents.send("desktop:pip-state", pipState);
  }

  function settleReady(ready: boolean) {
    if (readyTimeout) {
      clearTimeout(readyTimeout);
      readyTimeout = null;
    }

    const resolve = resolveReady;
    resolveReady = null;
    readyPromise = null;
    resolve?.(ready);
  }

  function waitForReady(): Promise<boolean> {
    if (pipReady) return Promise.resolve(true);
    if (readyPromise) return readyPromise;

    readyPromise = new Promise<boolean>((resolve) => {
      resolveReady = resolve;
      readyTimeout = setTimeout(() => {
        pipReady = false;
        settleReady(false);
        if (pipWindow && !pipWindow.isDestroyed()) {
          pipWindow.close();
        }
      }, DESKTOP_PIP_READY_TIMEOUT_MS);
    });

    return readyPromise;
  }

  function createWindow(windowSize?: DesktopPipWindowSize | null) {
    if (pipWindow && !pipWindow.isDestroyed()) {
      return pipWindow;
    }

    const normalizedWindowSize = normalizeWindowSize(windowSize);
    pipReady = false;

    pipWindow = new BrowserWindow({
      width: normalizedWindowSize?.width ?? DESKTOP_PIP_DEFAULT_WIDTH,
      height: normalizedWindowSize?.height ?? DESKTOP_PIP_DEFAULT_HEIGHT,
      minWidth: DESKTOP_PIP_MIN_WIDTH,
      minHeight: DESKTOP_PIP_MIN_HEIGHT,
      maxWidth: DESKTOP_PIP_MAX_WIDTH,
      maxHeight: DESKTOP_PIP_MAX_HEIGHT,
      backgroundColor: "#00000000",
      transparent: true,
      alwaysOnTop: true,
      frame: false,
      titleBarStyle: "hidden",
      thickFrame: false,
      resizable: true,
      skipTaskbar: true,
      autoHideMenuBar: true,
      show: false,
      fullscreenable: false,
      webPreferences: {
        preload: options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: options.enableDevTools,
        backgroundThrottling: false,
      },
    });

    if (process.platform === "darwin") {
      pipWindow.setAlwaysOnTop(true, "screen-saver");
      pipWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
      pipWindow.setAspectRatio(16 / 9);
      if (typeof (pipWindow as any).setWindowButtonVisibility === "function") {
        (pipWindow as any).setWindowButtonVisibility(false);
      }
    } else {
      pipWindow.setAlwaysOnTop(true);
    }

    pipWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });

    pipWindow.webContents.on("will-navigate", (event, url) => {
      if (isAllowedPipUrl(url)) return;
      const currentUrl = pipWindow?.webContents.getURL();
      if (url !== currentUrl && /^https?:\/\//i.test(url)) {
        void shell.openExternal(url);
      }
      event.preventDefault();
    });

    pipWindow.webContents.on("did-finish-load", () => {
      sendState();
    });

    pipWindow.once("ready-to-show", () => {
      pipWindow?.show();
    });

    pipWindow.on("resized", () => {
      snapPipWindowToCorner();
    });

    pipWindow.on("closed", () => {
      settleReady(false);
      pipWindow = null;
      pipState = null;
      pipReady = false;
      options.onClosed?.();
    });

    void pipWindow.loadURL(getPipUrl());
    snapPipWindowToCorner(false);

    return pipWindow;
  }

  return {
    getWindow() {
      return pipWindow;
    },
    close() {
      pipState = null;
      pipReady = false;
      settleReady(false);

      if (!pipWindow || pipWindow.isDestroyed()) {
        return Promise.resolve(false);
      }

      if (closePromise) return closePromise;

      const window = pipWindow;
      closePromise = new Promise<boolean>((resolve) => {
        const finish = () => {
          window.removeListener("closed", finish);
          closePromise = null;
          resolve(true);
        };

        window.once("closed", finish);
        window.close();
        if (window.isDestroyed()) finish();
      });

      return closePromise;
    },
    getState() {
      return pipState;
    },
    move(sender: { id: number }, xValue: unknown, yValue: unknown) {
      if (
        !pipWindow ||
        pipWindow.isDestroyed() ||
        pipWindow.webContents.id !== sender.id
      ) {
        return false;
      }

      const x = Number(xValue);
      const y = Number(yValue);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

      pipWindow.setPosition(Math.round(x), Math.round(y), false);
      return true;
    },
    snap(sender: { id: number }) {
      if (
        !pipWindow ||
        pipWindow.isDestroyed() ||
        pipWindow.webContents.id !== sender.id
      ) {
        return false;
      }

      snapPipWindowToCorner();
      return true;
    },
    async open(
      nextState: DesktopPipState,
      nextWindowSize?: DesktopPipWindowSize | null,
    ) {
      pipState = nextState ?? null;
      if (!pipState) return false;

      const window = createWindow(nextWindowSize);
      snapPipWindowToCorner();
      sendState();

      if (window.isMinimized()) {
        window.restore();
      }

      if (typeof window.showInactive === "function") {
        window.showInactive();
      } else {
        window.show();
      }

      return waitForReady();
    },
    ready(sender: { id: number }) {
      if (
        !pipWindow ||
        pipWindow.isDestroyed() ||
        pipWindow.webContents.id !== sender.id ||
        !pipState
      ) {
        return false;
      }

      pipReady = true;
      settleReady(true);
      sendState();
      return true;
    },
    activate() {
      if (!pipReady || !pipWindow || pipWindow.isDestroyed()) {
        return false;
      }

      pipWindow.webContents.send("desktop:pip-activate");
      return true;
    },
    update(nextState: DesktopPipState) {
      pipState = nextState ?? null;
      sendState();
      return Boolean(pipWindow && !pipWindow.isDestroyed());
    },
  };
}
