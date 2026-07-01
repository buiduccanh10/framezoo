import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
  type Input,
} from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const APP_ID = "com.alphaflix.desktop";
const APP_NAME = "AlphaFlix";
const DEFAULT_BACKEND_URL = "http://127.0.0.1:3000";
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;
const DESKTOP_BRIDGE_VERSION = "1.0.2";
const DESKTOP_PIP_ROUTE = "/desktop-pip";

const DEVTOOLS_PROTECTION_ENABLED =
  process.env.VITE_ENABLE_DEVTOOLS_PROTECTION === "true";
const ENABLE_DEVTOOLS = !DEVTOOLS_PROTECTION_ENABLED;

let mainWindow: BrowserWindow | null = null;
let desktopPipWindow: BrowserWindow | null = null;
let desktopPipState: Record<string, unknown> | null = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

type ExtensionMessageName =
  | "hello"
  | "makeRequest"
  | "prepareStream"
  | "openPage";

type StreamRule = {
  targetDomains: string[];
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
};

const streamRules = new Map<number, StreamRule>();

function getWindowIconPath() {
  return path.join(__dirname, "..", "build", "icon.png");
}

function normalizeWindowTitle(title: string) {
  const normalized = title
    .replace(/alpha\.flix/gi, APP_NAME)
    .replace(/AlphaFlix/gi, APP_NAME)
    .trim();

  return normalized.length > 0 ? normalized : APP_NAME;
}

function matchesRule(hostname: string, domains: string[]) {
  return domains.some((domain) => {
    const normalized = domain.toLowerCase();
    return (
      hostname === normalized || hostname.endsWith(`.${normalized}`)
    );
  });
}

function isDevtoolsShortcut(input: Input) {
  const key = input.key.toLowerCase();
  const macShortcut = input.meta && input.alt && ["i", "j", "c"].includes(key);
  const winShortcut =
    input.control && input.shift && ["i", "j", "c"].includes(key);

  return key === "f12" || macShortcut || winShortcut;
}

function serializeHeaders(headers: Headers) {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

function buildRequestBody(
  body: unknown,
  bodyType?: "string" | "FormData" | "URLSearchParams" | "object",
): BodyInit | undefined {
  if (body == null) return undefined;

  if (bodyType === "string") {
    return typeof body === "string" ? body : String(body);
  }

  if (bodyType === "URLSearchParams") {
    return new URLSearchParams((body as Array<[string, string]>) ?? []);
  }

  if (bodyType === "FormData") {
    const form = new FormData();
    for (const [key, value] of (body as Array<[string, string]>) ?? []) {
      form.append(key, value);
    }
    return form;
  }

  if (typeof body === "object") {
    return JSON.stringify(body);
  }

  return typeof body === "string" ? body : undefined;
}

async function handleExtensionMessage(
  message: ExtensionMessageName,
  payload?: any,
) {
  if (message === "hello") {
    return {
      success: true,
      version: DESKTOP_BRIDGE_VERSION,
      allowed: true,
      hasPermission: true,
    };
  }

  if (message === "prepareStream") {
    streamRules.set(payload.ruleId, {
      targetDomains: payload.targetDomains ?? [],
      requestHeaders: payload.requestHeaders,
      responseHeaders: payload.responseHeaders,
    });

    return { success: true };
  }

  if (message === "openPage") {
    if (payload?.page === "PermissionGrant") {
      if (mainWindow) {
        await dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Desktop mode enabled",
          message:
            "Desktop mode is built in to the Electron app. No extension permission step is required.",
        });
      }
      return { success: true };
    }

    if (typeof payload?.page === "string" && /^https?:\/\//i.test(payload.page)) {
      await shell.openExternal(payload.page);
      return { success: true };
    }

    return { success: true };
  }

  if (message === "makeRequest") {
    try {
      const headers = new Headers(payload?.headers ?? {});
      const body = buildRequestBody(payload?.body, payload?.bodyType);

      if (
        body &&
        payload?.bodyType === "object" &&
        !headers.has("content-type")
      ) {
        headers.set("content-type", "application/json");
      }

      const response = await fetch(payload.url, {
        method: payload?.method ?? "GET",
        headers,
        body,
        redirect: "follow",
      });

      const contentType = response.headers.get("content-type") ?? "";
      const rawText = await response.text();
      const parsedBody =
        contentType.includes("application/json") && rawText.length > 0
          ? (() => {
              try {
                return JSON.parse(rawText);
              } catch {
                return rawText;
              }
            })()
          : rawText;

      return {
        success: true,
        response: {
          statusCode: response.status,
          headers: serializeHeaders(response.headers),
          finalUrl: response.url || payload.url,
          body: parsedBody,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  return {
    success: false,
    error: `Unknown extension message: ${message}`,
  };
}

function registerHeaderInterceptors() {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    let nextHeaders = { ...details.requestHeaders };

    try {
      const hostname = new URL(details.url).hostname.toLowerCase();
      for (const rule of streamRules.values()) {
        if (!matchesRule(hostname, rule.targetDomains)) continue;
        nextHeaders = {
          ...nextHeaders,
          ...(rule.requestHeaders ?? {}),
        };
      }
    } catch {
      // Ignore invalid request URLs.
    }

    callback({ requestHeaders: nextHeaders });
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    let nextHeaders = details.responseHeaders;

    try {
      const hostname = new URL(details.url).hostname.toLowerCase();
      for (const rule of streamRules.values()) {
        if (
          !rule.responseHeaders ||
          !matchesRule(hostname, rule.targetDomains)
        ) {
          continue;
        }

        nextHeaders = {
          ...nextHeaders,
          ...Object.fromEntries(
            Object.entries(rule.responseHeaders).map(([key, value]) => [
              key,
              [value],
            ]),
          ),
        };
      }
    } catch {
      // Ignore invalid request URLs.
    }

    callback({ responseHeaders: nextHeaders });
  });
}

function getRendererEntryPath() {
  return path.join(__dirname, "..", "renderer", "index.html");
}

function getDesktopPipUrl() {
  if (RENDERER_DEV_URL) {
    return `${RENDERER_DEV_URL.replace(/\/$/, "")}/#${DESKTOP_PIP_ROUTE}`;
  }

  return `${pathToFileURL(getRendererEntryPath()).toString()}#${DESKTOP_PIP_ROUTE}`;
}

function notifyMainWindowDesktopPipClosed() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:pip-closed");
}

function sendDesktopPipState() {
  if (!desktopPipWindow || desktopPipWindow.isDestroyed() || !desktopPipState) {
    return;
  }

  desktopPipWindow.webContents.send("desktop:pip-state", desktopPipState);
}

function createDesktopPipWindow() {
  if (desktopPipWindow && !desktopPipWindow.isDestroyed()) {
    return desktopPipWindow;
  }

  desktopPipWindow = new BrowserWindow({
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
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      devTools: ENABLE_DEVTOOLS,
      backgroundThrottling: false,
    },
  });

  desktopPipWindow.setAlwaysOnTop(true, "screen-saver");
  desktopPipWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  desktopPipWindow.setAspectRatio(16 / 9);
  desktopPipWindow.setWindowButtonVisibility(false);

  desktopPipWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }

    return { action: "allow" };
  });

  desktopPipWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = desktopPipWindow?.webContents.getURL();
    if (url !== currentUrl && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  desktopPipWindow.webContents.on("did-finish-load", () => {
    sendDesktopPipState();
  });

  desktopPipWindow.once("ready-to-show", () => {
    desktopPipWindow?.show();
  });

  desktopPipWindow.on("closed", () => {
    desktopPipWindow = null;
    desktopPipState = null;
    notifyMainWindowDesktopPipClosed();
  });

  void desktopPipWindow.loadURL(getDesktopPipUrl());

  return desktopPipWindow;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#09090b",
    autoHideMenuBar: true,
    icon: getWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      devTools: ENABLE_DEVTOOLS,
    },
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (!ENABLE_DEVTOOLS && isDevtoolsShortcut(input)) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on("devtools-opened", () => {
    if (ENABLE_DEVTOOLS) return;
    mainWindow?.webContents.closeDevTools();
    mainWindow?.reload();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }

    return { action: "allow" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (url !== currentUrl && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.webContents.on("page-title-updated", (event, title) => {
    event.preventDefault();
    mainWindow?.setTitle(normalizeWindowTitle(title));
  });

  if (RENDERER_DEV_URL) {
    void mainWindow.loadURL(RENDERER_DEV_URL);
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    });
  } else {
    void mainWindow.loadFile(getRendererEntryPath());
  }

  mainWindow.on("closed", () => {
    if (desktopPipWindow && !desktopPipWindow.isDestroyed()) {
      desktopPipWindow.close();
    }
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle(
    "desktop:extension-message",
    async (_event, message: ExtensionMessageName, payload?: any) => {
      return handleExtensionMessage(message, payload);
    },
  );

  ipcMain.handle("desktop:open-external", async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) return false;
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("desktop:show-settings-placeholder", async () => {
    if (!mainWindow) return false;

    await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Desktop settings",
      message: "Desktop-specific settings are not implemented yet.",
    });

    return true;
  });

  ipcMain.handle("desktop:pip-open", async (_event, nextState: any) => {
    desktopPipState = nextState ?? null;
    if (!desktopPipState) return false;

    const pipWindow = createDesktopPipWindow();
    sendDesktopPipState();
    if (pipWindow.isMinimized()) {
      pipWindow.restore();
    }
    if (typeof pipWindow.showInactive === "function") {
      pipWindow.showInactive();
    } else {
      pipWindow.show();
    }
    return true;
  });

  ipcMain.handle("desktop:pip-update", async (_event, nextState: any) => {
    desktopPipState = nextState ?? null;
    sendDesktopPipState();
    return Boolean(desktopPipWindow && !desktopPipWindow.isDestroyed());
  });

  ipcMain.handle("desktop:pip-close", async () => {
    desktopPipState = null;

    if (!desktopPipWindow || desktopPipWindow.isDestroyed()) {
      notifyMainWindowDesktopPipClosed();
      return false;
    }

    desktopPipWindow.close();
    return true;
  });

  ipcMain.handle("desktop:pip-get-state", async () => {
    return desktopPipState;
  });

  ipcMain.handle("desktop:pip-action", async (_event, action: any) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    mainWindow.webContents.send("desktop:pip-action", action);
    return true;
  });

  ipcMain.handle("desktop:focus-main-window", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    return true;
  });
}

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch(
  "enable-features",
  "DocumentPictureInPictureAPI",
);
app.setName(APP_NAME);

if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID);
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  app.whenReady().then(() => {
    registerIpcHandlers();
    registerHeaderInterceptors();
    createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
