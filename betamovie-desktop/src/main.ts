import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
  type Input,
  type MenuItemConstructorOptions,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createDesktopAppUpdater } from "./desktopAppUpdater";
import { createDesktopPipController } from "./desktopPip";
import {
  createTorrentManagerFromEnvironment,
  TorrentManager,
} from "./torrent/manager";
import { libmpvController } from "./libmpvController";
import type {
  ExtensionMessageName,
  StreamRule,
  TorrentStartRequest,
} from "./types";

const APP_ID = "com.alphaflix.desktop";
const APP_NAME = "AlphaFlix";
const DEFAULT_BACKEND_URL = "http://127.0.0.1:3000";
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;
const RENDERER_PROTOCOL = "app";
const RENDERER_PROTOCOL_HOST = "renderer";
const ALLOWED_REMOTE_PROTOCOL_HOSTS = new Set(["www.gstatic.com"]);
const PACKAGED_RENDERER_URL = `${RENDERER_PROTOCOL}://${RENDERER_PROTOCOL_HOST}/index.html`;
const DESKTOP_BRIDGE_VERSION = "1.0.2";
const DESKTOP_PIP_ROUTE = "/desktop-pip";
const DESKTOP_APP_UPDATE_CHANNEL =
  process.env.BETAMOVIE_DESKTOP_UPDATE_CHANNEL ?? "stable";
const DESKTOP_APP_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const DESKTOP_SETTINGS_ROUTE = "/settings";
const EXTENSION_REQUEST_TIMEOUT_MS = 15_000;

const DEVTOOLS_PROTECTION_ENABLED =
  process.env.VITE_ENABLE_DEVTOOLS_PROTECTION === "true";
const ENABLE_DEVTOOLS = !DEVTOOLS_PROTECTION_ENABLED;

protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function setupTorrentEnv() {
  if (!process.env.BETAMOVIE_TORRENT_DATA_DIR) {
    const torrentDir = path.join(app.getPath("userData"), "torrents");
    try {
      fs.mkdirSync(torrentDir, { recursive: true });
    } catch {
      // ignore
    }
    process.env.BETAMOVIE_TORRENT_DATA_DIR = torrentDir;
  }
}

function getDirectorySize(dirPath: string): number {
  let size = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += getDirectorySize(fullPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        size += stat.size;
      }
    }
  } catch {
    // ignore
  }
  return size;
}

setupTorrentEnv();

const streamRules = new Map<number, StreamRule>();
const torrentManager: TorrentManager = createTorrentManagerFromEnvironment();

function supportsDesktopAppUpdates() {
  return process.platform === "darwin" || process.platform === "win32";
}

function getWindowIconPath() {
  return path.join(__dirname, "..", "build", "icon.png");
}

function getPreloadPath() {
  return path.join(__dirname, "preload.cjs");
}

function getRendererEntryPath() {
  return path.join(__dirname, "..", "renderer", "index.html");
}

function registerRendererProtocol() {
  protocol.handle(RENDERER_PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url);
      if (ALLOWED_REMOTE_PROTOCOL_HOSTS.has(url.hostname)) {
        return net.fetch(`https://${url.hostname}${url.pathname}${url.search}`);
      }

      if (url.hostname !== RENDERER_PROTOCOL_HOST) {
        return new Response("Not found", { status: 404 });
      }

      const rendererRoot = path.resolve(path.dirname(getRendererEntryPath()));
      const relativePath =
        decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      const filePath = path.resolve(rendererRoot, relativePath);

      if (
        filePath !== rendererRoot &&
        !filePath.startsWith(`${rendererRoot}${path.sep}`)
      ) {
        return new Response("Forbidden", { status: 403 });
      }

      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response("Bad renderer request", { status: 400 });
    }
  });
}

function getConfiguredBackendUrl() {
  return (
    process.env.BETAMOVIE_BACKEND_URL ??
    process.env.VITE_BACKEND_URL ??
    DEFAULT_BACKEND_URL
  );
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
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
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

    if (
      typeof payload?.page === "string" &&
      /^https?:\/\//i.test(payload.page)
    ) {
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
        signal: AbortSignal.timeout(EXTENSION_REQUEST_TIMEOUT_MS),
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

function notifyMainWindowDesktopPipClosed() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:pip-closed");
}

function focusMainWindow(window: BrowserWindow) {
  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  window.focus();
}

async function navigateMainWindowToRoute(route: string) {
  const window = getOrCreateMainWindow();
  focusMainWindow(window);

  const navigateScript = `
    (() => {
      const route = ${JSON.stringify(route)};
      const useNormalRouter = window.__CONFIG__?.VITE_NORMAL_ROUTER === "true";

      if (useNormalRouter) {
        if (window.location.pathname !== route) {
          window.history.pushState({}, "", route);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
        return;
      }

      if (window.location.hash !== "#" + route) {
        window.location.hash = route;
      }
    })();
  `;

  const applyRoute = () => {
    void window.webContents.executeJavaScript(navigateScript, true);
  };

  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once("did-finish-load", applyRoute);
    return;
  }

  applyRoute();
}

async function showDesktopSettings() {
  await navigateMainWindowToRoute(DESKTOP_SETTINGS_ROUTE);
}

async function showDesktopMessageBox(options: {
  type: "info" | "error";
  title: string;
  message: string;
  detail?: string;
}) {
  const parentWindow =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  if (parentWindow) {
    await dialog.showMessageBox(parentWindow, options);
    return;
  }

  await dialog.showMessageBox(options);
}

const desktopAppUpdater = createDesktopAppUpdater({
  appName: APP_NAME,
  checkIntervalMs: DESKTOP_APP_UPDATE_CHECK_INTERVAL_MS,
  getBackendUrl: getConfiguredBackendUrl,
  onStateChange: () => {
    sendDesktopAppUpdateState();
    installApplicationMenu();
  },
  updateChannel: DESKTOP_APP_UPDATE_CHANNEL,
});

const desktopPipController = createDesktopPipController({
  desktopPipRoute: DESKTOP_PIP_ROUTE,
  enableDevTools: ENABLE_DEVTOOLS,
  onClosed: notifyMainWindowDesktopPipClosed,
  preloadPath: getPreloadPath(),
  rendererAppUrl: PACKAGED_RENDERER_URL,
  rendererDevUrl: RENDERER_DEV_URL,
  rendererEntryPath: getRendererEntryPath(),
});

function sendDesktopAppUpdateState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(
    "desktop:app-update-state",
    desktopAppUpdater.getState(),
  );
}

function sendTorrentStatus(status: unknown) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:torrent-status", status);
}

async function handleDesktopAppUpdateMenuAction() {
  const updateState = desktopAppUpdater.getState();

  if (updateState.status === "downloaded") {
    desktopAppUpdater.installUpdate();
    return;
  }

  if (updateState.status === "available") {
    const didStartDownload = await desktopAppUpdater.downloadUpdate();

    if (!didStartDownload) {
      const nextState = desktopAppUpdater.getState();
      await showDesktopMessageBox({
        type: "error",
        title: "Desktop update failed",
        message:
          nextState.errorMessage ??
          "Unable to download the latest desktop update.",
      });
    }
    return;
  }

  if (
    updateState.status === "checking" ||
    updateState.status === "downloading"
  ) {
    return;
  }

  const hasUpdate = await desktopAppUpdater.checkForUpdate();
  const nextState = desktopAppUpdater.getState();

  if (hasUpdate) return;

  if (nextState.status === "error") {
    await showDesktopMessageBox({
      type: "error",
      title: "Desktop update failed",
      message:
        nextState.errorMessage ??
        "Unable to check for desktop updates right now.",
    });
    return;
  }

  await showDesktopMessageBox({
    type: "info",
    title: "AlphaFlix is up to date",
    message: `You are already on the latest desktop version (v${app.getVersion()}).`,
  });
}

function getDesktopUpdateMenuItem(): MenuItemConstructorOptions {
  const updateState = desktopAppUpdater.getState();
  const canUseUpdates = app.isPackaged && supportsDesktopAppUpdates();
  let label = "Check for Updates…";
  let enabled = canUseUpdates;

  switch (updateState.status) {
    case "checking":
      label = "Checking for Updates…";
      enabled = false;
      break;
    case "available":
      label = updateState.updateVersion
        ? `Download Update v${updateState.updateVersion}`
        : "Download Update";
      break;
    case "downloading":
      label =
        typeof updateState.progressPercent === "number"
          ? `Downloading Update… ${Math.round(updateState.progressPercent)}%`
          : "Downloading Update…";
      enabled = false;
      break;
    case "downloaded":
      label = updateState.updateVersion
        ? `Restart to Update to v${updateState.updateVersion}`
        : "Restart to Update";
      break;
    case "error":
      label = "Retry Update Check";
      break;
    default:
      break;
  }

  return {
    label,
    enabled,
    click: () => {
      void handleDesktopAppUpdateMenuAction();
    },
  };
}

function buildApplicationMenu() {
  const settingsMenuItem: MenuItemConstructorOptions = {
    label: "Settings…",
    accelerator: "CmdOrCtrl+,",
    click: () => {
      void showDesktopSettings();
    },
  };

  const helpSubmenu: MenuItemConstructorOptions[] = [
    getDesktopUpdateMenuItem(),
    {
      label: `Version ${app.getVersion()}`,
      enabled: false,
    },
  ];

  const template: MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: "about" },
              { type: "separator" },
              settingsMenuItem,
              getDesktopUpdateMenuItem(),
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          {
            label: "File",
            submenu: [
              settingsMenuItem,
              { type: "separator" },
              { role: "close" },
            ],
          },
          {
            label: "Edit",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          {
            label: "View",
            submenu: [
              { role: "reload" },
              { role: "forceReload" },
              ...(ENABLE_DEVTOOLS
                ? ([{ role: "toggleDevTools" }] as const)
                : []),
              { type: "separator" },
              { role: "resetZoom" },
              { role: "zoomIn" },
              { role: "zoomOut" },
              { type: "separator" },
              { role: "togglefullscreen" },
            ],
          },
          {
            label: "Window",
            submenu: [
              { role: "minimize" },
              { role: "zoom" },
              { role: "front" },
            ],
          },
          {
            label: "Help",
            submenu: helpSubmenu,
          },
        ]
      : [
          {
            label: "File",
            submenu: [
              settingsMenuItem,
              getDesktopUpdateMenuItem(),
              { type: "separator" },
              { role: "quit" },
            ],
          },
          {
            label: "Edit",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          {
            label: "View",
            submenu: [
              { role: "reload" },
              { role: "forceReload" },
              ...(ENABLE_DEVTOOLS
                ? ([{ role: "toggleDevTools" }] as const)
                : []),
              { type: "separator" },
              { role: "resetZoom" },
              { role: "zoomIn" },
              { role: "zoomOut" },
              { type: "separator" },
              { role: "togglefullscreen" },
            ],
          },
          {
            label: "Help",
            submenu: [{ role: "about" }, { type: "separator" }, ...helpSubmenu],
          },
        ];

  return Menu.buildFromTemplate(template);
}

function installApplicationMenu() {
  const applicationMenu = buildApplicationMenu();
  Menu.setApplicationMenu(applicationMenu);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setMenu(applicationMenu);
    mainWindow.setAutoHideMenuBar(process.platform === "darwin");
    mainWindow.setMenuBarVisibility(process.platform !== "darwin");
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#00000000",
    transparent: true,
    titleBarStyle: "default" as const,
    autoHideMenuBar: process.platform === "darwin",
    icon: getWindowIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      devTools: ENABLE_DEVTOOLS,
    },
  });

  if (process.platform === "darwin") {
    mainWindow.setWindowButtonVisibility(true);
  }
  libmpvController.init(mainWindow, () => desktopPipController.getWindow());

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
      sendDesktopAppUpdateState();
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    });
  } else {
    void mainWindow.loadURL(PACKAGED_RENDERER_URL);
    mainWindow.webContents.on("did-finish-load", () => {
      sendDesktopAppUpdateState();
    });
  }

  mainWindow.on("closed", () => {
    desktopPipController.close();
    mainWindow = null;
  });

  installApplicationMenu();
  return mainWindow;
}

function getOrCreateMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return createMainWindow();
  }

  return mainWindow;
}

function registerIpcHandlers() {
  ipcMain.handle("desktop:app-update-get-state", async () => {
    return desktopAppUpdater.getState();
  });

  ipcMain.handle("desktop:app-update-check", async () => {
    return desktopAppUpdater.checkForUpdate();
  });

  ipcMain.handle("desktop:app-update-download", async () => {
    return desktopAppUpdater.downloadUpdate();
  });

  ipcMain.handle("desktop:app-update-install", async () => {
    return desktopAppUpdater.installUpdate();
  });

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
    await showDesktopSettings();
    return true;
  });

  ipcMain.handle(
    "desktop:pip-open",
    async (_event, nextState: any, nextWindowSize: any) => {
      return desktopPipController.open(
        nextState ?? null,
        nextWindowSize ?? null,
      );
    },
  );

  ipcMain.handle("desktop:pip-update", async (_event, nextState: any) => {
    return desktopPipController.update(nextState ?? null);
  });

  ipcMain.handle("desktop:pip-close", async () => {
    const didClose = desktopPipController.close();
    if (!didClose) {
      notifyMainWindowDesktopPipClosed();
    }
    return didClose;
  });

  ipcMain.handle("desktop:pip-get-state", async () => {
    return desktopPipController.getState();
  });

  ipcMain.handle("desktop:pip-action", async (_event, action: any) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    mainWindow.webContents.send("desktop:pip-action", action);
    return true;
  });

  ipcMain.handle("desktop:focus-main-window", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    focusMainWindow(mainWindow);
    return true;
  });

  torrentManager.subscribe(sendTorrentStatus);

  ipcMain.handle(
    "desktop:torrent-start",
    async (_event, request: TorrentStartRequest) => {
      if (!request || typeof request.sourceId !== "string") {
        throw new Error("invalid torrent start request");
      }
      return torrentManager.start(request);
    },
  );

  ipcMain.handle("desktop:torrent-stop", async (_event, sessionId: string) => {
    await torrentManager.stop(sessionId);
    return true;
  });

  ipcMain.handle(
    "desktop:torrent-get-status",
    async (_event, sessionId: string) => {
      return torrentManager.getStatus(sessionId);
    },
  );

  ipcMain.handle("desktop:torrent-get-storage-info", async () => {
    const torrentDir =
      process.env.BETAMOVIE_TORRENT_DATA_DIR ||
      path.join(app.getPath("userData"), "torrents");
    let totalBytes = 0;
    try {
      if (fs.existsSync(torrentDir)) {
        const files = fs.readdirSync(torrentDir);
        for (const file of files) {
          const fullPath = path.join(torrentDir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            totalBytes += getDirectorySize(fullPath);
          } else {
            totalBytes += stat.size;
          }
        }
      }
    } catch {
      // ignore
    }
    return {
      path: torrentDir,
      usedBytes: totalBytes,
      maxBytes: 5 * 1024 * 1024 * 1024,
    };
  });

  ipcMain.handle("desktop:torrent-clear-storage", async () => {
    const torrentDir =
      process.env.BETAMOVIE_TORRENT_DATA_DIR ||
      path.join(app.getPath("userData"), "torrents");
    try {
      if (fs.existsSync(torrentDir)) {
        const entries = fs.readdirSync(torrentDir);
        for (const entry of entries) {
          const fullPath = path.join(torrentDir, entry);
          fs.rmSync(fullPath, { recursive: true, force: true });
        }
      }
      return true;
    } catch (err) {
      console.error("Failed to clear torrent storage:", err);
      return false;
    }
  });
}

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("enable-features", "DocumentPictureInPictureAPI");
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
    registerRendererProtocol();
    registerIpcHandlers();
    registerHeaderInterceptors();
    installApplicationMenu();
    createMainWindow();
    desktopAppUpdater.initialize();

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

app.on("before-quit", () => {
  desktopAppUpdater.dispose();
  void torrentManager.dispose();
});
