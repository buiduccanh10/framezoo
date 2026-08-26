import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  screen,
  session,
  shell,
  type Input,
  type MenuItemConstructorOptions,
  type Rectangle,
} from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createDesktopAppUpdater } from "./desktopAppUpdater";
import { createDesktopPipController } from "./desktopPip";
import { AddonProtocolEngine } from "./addons/engine";
import type { AddonProtocolRequest } from "./addons/types";
import {
  createTorrentManagerFromEnvironment,
  TorrentManager,
} from "./torrent/manager";
import { libmpvController } from "./libmpvController";
import {
  MoonshineNodeRuntime,
  type MoonshineNodeModel,
} from "./moonshineNodeRuntime";
import type {
  ExtensionMessageName,
  NativeStartupWarmupState,
  NativeWarmupComponentState,
  StreamRule,
  TorrentStartRequest,
} from "./types";

const APP_ID = "com.framezoo.desktop";
const APP_NAME = "Framezoo";

app.setName(APP_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID);
}

const DEFAULT_BACKEND_URL = "http://127.0.0.1:3000";
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;
const RENDERER_PROTOCOL = "app";
const RENDERER_PROTOCOL_HOST = "renderer";
const ALLOWED_REMOTE_PROTOCOL_HOSTS = new Set(["www.gstatic.com"]);
const PACKAGED_RENDERER_URL = `${RENDERER_PROTOCOL}://${RENDERER_PROTOCOL_HOST}/index.html`;
const DESKTOP_BRIDGE_VERSION = "1.0.2";
const DESKTOP_PIP_ROUTE = "/desktop-pip";
const DESKTOP_APP_UPDATE_CHANNEL =
  process.env.FRAMEZOO_DESKTOP_UPDATE_CHANNEL ?? "stable";
const DESKTOP_APP_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const DESKTOP_SETTINGS_ROUTE = "/settings";
const EXTENSION_REQUEST_TIMEOUT_MS = 15_000;
const moonshineDownloadControllers = new Map<string, AbortController>();
const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const ENABLE_DEVTOOLS =
  Boolean(RENDERER_DEV_URL) ||
  process.env.VITE_ENABLE_DEVTOOLS_PROTECTION === "false";

function isAllowedRendererUrl(url: string) {
  const allowedUrl = RENDERER_DEV_URL ?? PACKAGED_RENDERER_URL;
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
const PROTOCOL_PREFIX = "framezoo";

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL_PREFIX, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL_PREFIX);
}

function handleDeepLink(url: string) {
  const deepLinkPath = url.replace(new RegExp(`^${PROTOCOL_PREFIX}:/+`), "/");

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send("desktop:deep-link", deepLinkPath);
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

function copyDirectoryContentsRecursive(src: string, dest: string) {
  try {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDirectoryContentsRecursive(srcPath, destPath);
      } else if (entry.isFile()) {
        if (!fs.existsSync(destPath)) {
          try {
            fs.copyFileSync(srcPath, destPath);
          } catch {
            // ignore copy errors for individual files
          }
        }
      }
    }
  } catch {
    // ignore directory read errors
  }
}

function migrateLegacyTorrentDirs(targetDir: string) {
  try {
    const normalizedTarget = path.resolve(targetDir);
    const candidateDirs: (string | null | undefined)[] = [
      path.join(app.getPath("appData"), "FrameZoo", "torrents"),
      path.join(app.getPath("appData"), "AlphaFlix", "torrents"),
      path.join(app.getPath("appData"), "BetaMovie", "torrents"),
      path.join(os.tmpdir(), "framezoo-torrents"),
      path.join(os.tmpdir(), "betamovie-torrents"),
      typeof process.resourcesPath === "string"
        ? path.join(process.resourcesPath, "torrents")
        : null,
      typeof process.resourcesPath === "string"
        ? path.join(process.resourcesPath, "torrent-engine", "torrents")
        : null,
    ];

    if (process.platform === "darwin") {
      let appPath = process.execPath;
      if (appPath.includes(".app/Contents/MacOS/")) {
        appPath = appPath.substring(0, appPath.indexOf(".app") + 4);
        candidateDirs.push(
          path.join(appPath, "Contents", "Resources", "torrents"),
          path.join(
            appPath,
            "Contents",
            "Resources",
            "torrent-engine",
            "torrents",
          ),
          path.join(appPath, "torrents"),
        );
      }
    }

    for (const candidate of candidateDirs) {
      if (!candidate) continue;
      const normalizedCandidate = path.resolve(candidate);
      if (normalizedCandidate === normalizedTarget) continue;
      if (fs.existsSync(normalizedCandidate)) {
        copyDirectoryContentsRecursive(normalizedCandidate, normalizedTarget);
      }
    }
  } catch {
    // ignore migration errors
  }
}

function setupTorrentEnv() {
  if (!process.env.FRAMEZOO_TORRENT_DATA_DIR) {
    const torrentDir = path.join(app.getPath("userData"), "torrents");
    try {
      fs.mkdirSync(torrentDir, { recursive: true });
    } catch {
      // ignore
    }
    process.env.FRAMEZOO_TORRENT_DATA_DIR = torrentDir;
  }
  migrateLegacyTorrentDirs(process.env.FRAMEZOO_TORRENT_DATA_DIR);
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

function crc32c(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = CRC32C_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function crc32cBase64(bytes: Uint8Array): string {
  const value = crc32c(bytes);
  return Buffer.from([
    value >>> 24,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]).toString("base64");
}

function verifyMoonshineFileChecksum(
  bytes: Uint8Array,
  file: {
    name: string;
    checksum: string | null;
    checksumType: string | null;
  },
) {
  if (!file.checksum) return;
  if (file.checksumType !== "crc32c") {
    throw new Error(
      `Unsupported Moonshine checksum type for ${file.name}: ${file.checksumType ?? "unknown"}`,
    );
  }
  if (crc32cBase64(bytes) !== file.checksum) {
    throw new Error(`Moonshine model checksum mismatch for ${file.name}`);
  }
}

setupTorrentEnv();

const streamRules = new Map<number, StreamRule>();
const torrentManager: TorrentManager = createTorrentManagerFromEnvironment();
const addonProtocolEngine = new AddonProtocolEngine();
const moonshineNodeRuntime = new MoonshineNodeRuntime(
  () => [
    path.join(path.dirname(getRendererEntryPath()), "moonshine", "models"),
    path.join(__dirname, "..", "renderer-src", "public", "moonshine", "models"),
  ],
  () => path.join(app.getPath("userData"), "moonshine-models"),
  () => {
    const runtimeRoots = [
      path.join(path.dirname(getRendererEntryPath()), "moonshine", "runtime"),
      path.join(
        __dirname,
        "..",
        "renderer-src",
        "public",
        "moonshine",
        "runtime",
      ),
    ];
    const runtimeRoot = runtimeRoots.find((root) =>
      fs.existsSync(path.join(root, "module.js")),
    );
    if (!runtimeRoot) {
      throw new Error("Moonshine runtime is unavailable");
    }
    return runtimeRoot;
  },
);

// Warmup state – tracks whether the torrent engine has been initialised.
type TorrentWarmupState =
  | { status: "idle" }
  | { status: "warming" }
  | { status: "ready" }
  | { status: "error"; message: string };
let torrentWarmupState: TorrentWarmupState = { status: "idle" };
let libmpvWarmupState: NativeWarmupComponentState = { status: "idle" };
let startupWarmupPromise: Promise<void> | null = null;
let torrentWarmupPromise: Promise<boolean> | null = null;
const STARTUP_WARMUP_TIMEOUT_MS = 90_000;

function getStartupWarmupState(): NativeStartupWarmupState {
  const status =
    torrentWarmupState.status === "warming" ||
    libmpvWarmupState.status === "warming"
      ? "warming"
      : torrentWarmupState.status === "ready" &&
          libmpvWarmupState.status === "ready"
        ? "ready"
        : torrentWarmupState.status === "error" ||
            libmpvWarmupState.status === "error"
          ? "degraded"
          : "idle";

  return {
    status,
    torrent: torrentWarmupState,
    libmpv: libmpvWarmupState,
  };
}

function publishStartupWarmupState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(
      "desktop:native-warmup-state",
      getStartupWarmupState(),
    );
  }
}

function setWarmupState(next: TorrentWarmupState) {
  torrentWarmupState = next;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop:torrent-warmup-state", next);
  }
  publishStartupWarmupState();
}

function runTorrentWarmup(): Promise<boolean> {
  if (torrentWarmupState.status === "ready") return Promise.resolve(true);
  if (torrentWarmupPromise) return torrentWarmupPromise;

  setWarmupState({ status: "warming" });
  torrentWarmupPromise = (async () => {
    const timeoutController = new AbortController();
    const timeoutPromise = delay(STARTUP_WARMUP_TIMEOUT_MS, undefined, {
      signal: timeoutController.signal,
    }).then(() => {
      throw new Error("Torrent warmup timed out");
    });
    try {
      await Promise.race([torrentManager.warmup(), timeoutPromise]);
      setWarmupState({ status: "ready" });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[torrent] warmup failed:", message);
      setWarmupState({ status: "error", message });
      return false;
    } finally {
      timeoutController.abort();
    }
  })().finally(() => {
    torrentWarmupPromise = null;
  });

  return torrentWarmupPromise;
}

function runStartupNativeWarmup(): Promise<void> {
  if (startupWarmupPromise) return startupWarmupPromise;

  startupWarmupPromise = (async () => {
    libmpvWarmupState = { status: "warming" };
    publishStartupWarmupState();

    const [torrentOk, libmpvResult] = await Promise.all([
      runTorrentWarmup(),
      libmpvController.warmup(),
    ]);

    libmpvWarmupState = libmpvResult.ok
      ? { status: "ready" }
      : {
          status: "error",
          message: libmpvResult.message ?? "Native libmpv warmup failed",
        };
    publishStartupWarmupState();

    if (!torrentOk || !libmpvResult.ok) {
      console.warn("[startup] native warmup completed in degraded mode", {
        torrentOk,
        libmpvOk: libmpvResult.ok,
      });
    }
  })();

  return startupWarmupPromise;
}

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

      if (url.pathname.startsWith("/moonshine-cache/")) {
        const cacheParts = decodeURIComponent(url.pathname)
          .replace(/^\/moonshine-cache\//, "")
          .split("/");
        if (
          cacheParts.length !== 3 ||
          !["tiny", "base"].includes(cacheParts[0] ?? "") ||
          !/^[a-z0-9_-]+$/i.test(cacheParts[1] ?? "") ||
          !/^[a-z0-9._-]+$/i.test(cacheParts[2] ?? "")
        ) {
          return new Response("Not found", { status: 404 });
        }
        const cachePath = path.join(
          app.getPath("userData"),
          "moonshine-models",
          cacheParts[0]!,
          cacheParts[1]!,
          cacheParts[2]!,
        );
        if (!fs.existsSync(cachePath)) {
          return new Response("Not found", { status: 404 });
        }
        return net.fetch(pathToFileURL(cachePath).toString());
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
    process.env.FRAMEZOO_BACKEND_URL ??
    process.env.VITE_BACKEND_URL ??
    DEFAULT_BACKEND_URL
  );
}

function normalizeWindowTitle(title: string) {
  const normalized = title.replace(/Framezoo/gi, APP_NAME).trim();

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
  libmpvController.reparentPipPlayersToMain();
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
  beforeInstall: async () => {
    try {
      await torrentManager.stopAll();
    } catch (error) {
      console.error(
        "[main] Failed to stop torrents before update install:",
        error,
      );
    }
    try {
      await torrentManager.dispose();
    } catch (error) {
      console.error(
        "[main] Failed to dispose torrent manager before update install:",
        error,
      );
    }
    try {
      const torrentDir =
        process.env.FRAMEZOO_TORRENT_DATA_DIR ||
        path.join(app.getPath("userData"), "torrents");
      migrateLegacyTorrentDirs(torrentDir);
    } catch (error) {
      console.error(
        "[main] Failed to sync torrent cache before update install:",
        error,
      );
    }
  },
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
    title: "Framezoo is up to date",
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
    mainWindow.setAutoHideMenuBar(true);
    mainWindow.setMenuBarVisibility(false);
  }
}

let isWindowsFullScreen = false;
let savedWindowBounds: Rectangle | null = null;
let wasMaximizedBeforePlayerFullscreen = false;
let fullscreenOrigin: "player" | "user" | null = null;
let isFullScreenTransitioning = false;
let targetFullScreen: boolean | null = null;
let fullscreenTransitionTimeout: NodeJS.Timeout | null = null;

function clearFullscreenTransition() {
  if (fullscreenTransitionTimeout) {
    clearTimeout(fullscreenTransitionTimeout);
    fullscreenTransitionTimeout = null;
  }
  isFullScreenTransitioning = false;
  targetFullScreen = null;
}

function isAppFullScreen(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (process.platform === "win32") {
    return isWindowsFullScreen;
  }
  if (targetFullScreen !== null && isFullScreenTransitioning) {
    return targetFullScreen;
  }
  return mainWindow.isFullScreen();
}

function setAppFullScreen(
  fullscreen: boolean,
  origin: "player" | "user" = "user",
) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (process.platform === "win32") {
    if (fullscreen === isWindowsFullScreen) return;
    if (fullscreen) {
      fullscreenOrigin = origin;
      wasMaximizedBeforePlayerFullscreen = mainWindow.isMaximized();
      savedWindowBounds = mainWindow.getBounds();
      const currentDisplay = screen.getDisplayMatching(savedWindowBounds);
      isWindowsFullScreen = true;
      mainWindow.setAutoHideMenuBar(true);
      mainWindow.setMenuBarVisibility(false);
      mainWindow.setBounds(currentDisplay.bounds);
      mainWindow.webContents.send("desktop:fullscreen-state", true);
    } else {
      isWindowsFullScreen = false;
      mainWindow.setAutoHideMenuBar(true);
      mainWindow.setMenuBarVisibility(false);
      if (wasMaximizedBeforePlayerFullscreen) {
        mainWindow.maximize();
      } else if (savedWindowBounds) {
        const currentDisplay = screen.getDisplayMatching(savedWindowBounds);
        const workArea = currentDisplay?.workArea ?? {
          x: 0,
          y: 0,
          width: 1440,
          height: 900,
        };
        const width = Math.min(
          workArea.width,
          Math.max(960, savedWindowBounds.width),
        );
        const height = Math.min(
          workArea.height,
          Math.max(600, savedWindowBounds.height),
        );
        mainWindow.setBounds({
          x: Math.max(
            workArea.x,
            Math.min(savedWindowBounds.x, workArea.x + workArea.width - width),
          ),
          y: Math.max(
            workArea.y,
            Math.min(
              savedWindowBounds.y,
              workArea.y + workArea.height - height,
            ),
          ),
          width,
          height,
        });
      } else {
        const primaryDisplay = screen.getPrimaryDisplay();
        const workArea = primaryDisplay?.workArea ?? {
          width: 1440,
          height: 900,
        };
        const initialWidth = Math.min(
          1440,
          Math.max(960, Math.round(workArea.width * 0.85)),
        );
        const initialHeight = Math.min(
          900,
          Math.max(600, Math.round(workArea.height * 0.85)),
        );
        mainWindow.setSize(initialWidth, initialHeight);
        mainWindow.center();
      }
      fullscreenOrigin = null;
      wasMaximizedBeforePlayerFullscreen = false;
      mainWindow.webContents.send("desktop:fullscreen-state", false);
    }
  } else {
    const currentFull = mainWindow.isFullScreen();
    if (fullscreen === currentFull && !isFullScreenTransitioning) return;
    if (isFullScreenTransitioning && targetFullScreen === fullscreen) return;

    if (fullscreenTransitionTimeout) {
      clearTimeout(fullscreenTransitionTimeout);
    }
    targetFullScreen = fullscreen;
    isFullScreenTransitioning = true;
    fullscreenOrigin = origin;

    if (fullscreen) {
      savedWindowBounds = mainWindow.getBounds();
      mainWindow.setFullScreen(true);
    } else {
      mainWindow.setFullScreen(false);
    }
    mainWindow.webContents.send("desktop:fullscreen-state", fullscreen);

    fullscreenTransitionTimeout = setTimeout(() => {
      clearFullscreenTransition();
      if (mainWindow && !mainWindow.isDestroyed()) {
        const actualFull = mainWindow.isFullScreen();
        mainWindow.webContents.send("desktop:fullscreen-state", actualFull);
      }
    }, 1500);
  }
}

function togglePlayerFullScreen() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  setAppFullScreen(!isAppFullScreen(), "player");
}

function exitPlayerFullScreen() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  setAppFullScreen(false, "player");
}

let lastNormalBounds: Rectangle | null = null;

function createMainWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay?.workArea ?? { width: 1440, height: 900 };
  const initialWidth = Math.min(
    1440,
    Math.max(960, Math.round(workArea.width * 0.85)),
  );
  const initialHeight = Math.min(
    900,
    Math.max(600, Math.round(workArea.height * 0.85)),
  );

  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: initialWidth,
    height: initialHeight,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#00000000",
    transparent: true,
    fullscreenable: true,
    titleBarStyle: "default" as const,
    autoHideMenuBar: true,
    icon: getWindowIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: ENABLE_DEVTOOLS,
    },
  });

  if (process.platform === "darwin") {
    mainWindow.setFullScreenable(true);
    mainWindow.setWindowButtonVisibility(true);
  }
  libmpvController.init(
    mainWindow,
    () => desktopPipController.getWindow(),
    () => startupWarmupPromise ?? Promise.resolve(),
  );

  // The renderer cannot reliably finish async IPC during a full navigation.
  // Ignore same-document SPA navigations used by player overlays/popups.
  mainWindow.webContents.on("did-start-navigation", (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    libmpvController.destroyAll("main-window:did-start-navigation");
  });
  mainWindow.webContents.on("render-process-gone", () => {
    libmpvController.destroyAll("main-window:render-process-gone");
  });

  const updateNormalBounds = () => {
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.isMaximized() &&
      !mainWindow.isMinimized() &&
      !isAppFullScreen()
    ) {
      lastNormalBounds = mainWindow.getBounds();
    }
  };
  mainWindow.on("resize", updateNormalBounds);
  mainWindow.on("move", updateNormalBounds);

  mainWindow.on("maximize", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("desktop:maximize-state", true);
    }
  });

  mainWindow.on("unmaximize", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("desktop:maximize-state", false);
    }
  });

  mainWindow.on("enter-full-screen", () => {
    clearFullscreenTransition();
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (process.platform === "win32") {
        isWindowsFullScreen = true;
        mainWindow.setAutoHideMenuBar(true);
        mainWindow.setMenuBarVisibility(false);
      }
      if (!fullscreenOrigin) {
        fullscreenOrigin = "user";
      }
      mainWindow.webContents.send("desktop:fullscreen-state", true);
    }
  });

  mainWindow.on("leave-full-screen", () => {
    clearFullscreenTransition();
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (process.platform === "win32") {
        isWindowsFullScreen = false;
        mainWindow.setAutoHideMenuBar(true);
        mainWindow.setMenuBarVisibility(false);
      }
      fullscreenOrigin = null;
      wasMaximizedBeforePlayerFullscreen = false;
      mainWindow.webContents.send("desktop:fullscreen-state", false);
    }
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
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedRendererUrl(url)) return;
    const currentUrl = mainWindow?.webContents.getURL();
    if (url !== currentUrl && /^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    event.preventDefault();
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
    clearFullscreenTransition();
    desktopPipController.close();
    mainWindow = null;
    savedWindowBounds = null;
    wasMaximizedBeforePlayerFullscreen = false;
    fullscreenOrigin = null;
    isWindowsFullScreen = false;
    void torrentManager.stopAll();
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

  ipcMain.handle(
    "desktop:addon-manifest",
    async (_event, manifestUrl: string) => {
      return addonProtocolEngine.loadManifest(manifestUrl);
    },
  );

  ipcMain.handle(
    "desktop:addon-request",
    async (_event, request: AddonProtocolRequest) => {
      return addonProtocolEngine.request(request);
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
    "desktop:moonshine-model-has",
    async (_event, architecture: "tiny" | "base", language: string) => {
      const modelRoot = path.join(
        app.getPath("userData"),
        "moonshine-models",
        architecture,
        language,
      );
      return (
        fs.existsSync(modelRoot) &&
        fs.readdirSync(modelRoot).some((entry) => entry.endsWith(".ort")) &&
        fs.existsSync(path.join(modelRoot, "tokenizer.bin"))
      );
    },
  );

  ipcMain.handle(
    "desktop:moonshine-local-load",
    async (_event, model: MoonshineNodeModel) => {
      await moonshineNodeRuntime.loadModel(model);
      return true;
    },
  );

  ipcMain.handle(
    "desktop:moonshine-local-transcribe",
    async (
      _event,
      requestId: string,
      model: MoonshineNodeModel,
      audio: ArrayBuffer,
      sampleRate: number,
    ) => {
      if (
        typeof requestId !== "string" ||
        !(audio instanceof ArrayBuffer) ||
        !Number.isFinite(sampleRate) ||
        sampleRate <= 0
      ) {
        throw new Error("Invalid Moonshine local inference request");
      }
      try {
        return await moonshineNodeRuntime.transcribe(
          requestId,
          model,
          audio,
          sampleRate,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return { cancelled: true as const };
        }
        throw error;
      }
    },
  );

  ipcMain.handle(
    "desktop:moonshine-local-cancel",
    async (_event, requestId: string) => {
      return moonshineNodeRuntime.cancel(requestId);
    },
  );

  ipcMain.handle(
    "desktop:moonshine-model-cancel",
    async (_event, requestId: string) => {
      const controller = moonshineDownloadControllers.get(requestId);
      if (!controller) return false;
      controller.abort();
      return true;
    },
  );

  ipcMain.handle(
    "desktop:moonshine-model-download",
    async (
      _event,
      requestId: string,
      request: {
        architecture: "tiny" | "base";
        language: string;
        files: Array<{
          name: string;
          url: string;
          size: number;
          checksum: string | null;
          checksumType: string | null;
        }>;
      },
    ) => {
      if (
        !/^[a-z0-9_-]+$/i.test(request.language) ||
        !["tiny", "base"].includes(request.architecture) ||
        !Array.isArray(request.files) ||
        request.files.length === 0
      ) {
        throw new Error("Invalid Moonshine model download request");
      }
      const controller = new AbortController();
      moonshineDownloadControllers.set(requestId, controller);
      const modelRoot = path.join(
        app.getPath("userData"),
        "moonshine-models",
        request.architecture,
        request.language,
      );
      const tempRoot = `${modelRoot}.partial-${requestId}`;
      try {
        await fs.promises.rm(tempRoot, { recursive: true, force: true });
        await fs.promises.mkdir(tempRoot, { recursive: true });
        for (const file of request.files) {
          if (
            !/^[a-z0-9._-]+$/i.test(file.name) ||
            !/^https:\/\//i.test(file.url) ||
            !Number.isFinite(file.size) ||
            file.size <= 0
          ) {
            throw new Error("Invalid Moonshine model file");
          }
          const response = await fetch(file.url, { signal: controller.signal });
          if (!response.ok || !response.body) {
            throw new Error(
              `Moonshine model download failed: ${response.status} ${file.url}`,
            );
          }
          const chunks: Buffer[] = [];
          let loaded = 0;
          for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
            if (controller.signal.aborted) {
              throw new DOMException("Aborted", "AbortError");
            }
            const bytes = Buffer.from(chunk);
            chunks.push(bytes);
            loaded += bytes.byteLength;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("desktop:moonshine-model-progress", {
                requestId,
                language: request.language,
                architecture: request.architecture,
                file: file.name,
                loaded,
                total: file.size,
              });
            }
          }
          const bytes = Buffer.concat(chunks);
          if (bytes.byteLength !== file.size) {
            throw new Error(
              `Moonshine model size mismatch for ${file.name}: expected ${file.size}, got ${bytes.byteLength}`,
            );
          }
          verifyMoonshineFileChecksum(bytes, file);
          await fs.promises.writeFile(path.join(tempRoot, file.name), bytes);
        }
        await fs.promises.rm(modelRoot, { recursive: true, force: true });
        await fs.promises.mkdir(path.dirname(modelRoot), { recursive: true });
        await fs.promises.rename(tempRoot, modelRoot);
        return true;
      } finally {
        moonshineDownloadControllers.delete(requestId);
        await fs.promises
          .rm(tempRoot, { recursive: true, force: true })
          .catch(() => {});
      }
    },
  );

  ipcMain.handle(
    "desktop:pip-open",
    async (_event, nextState: any, nextWindowSize: any) => {
      return desktopPipController.open(
        nextState ?? null,
        nextWindowSize ?? null,
      );
    },
  );

  ipcMain.handle("desktop:pip-ready", (event) => {
    return desktopPipController.ready(event.sender);
  });

  ipcMain.handle("desktop:pip-activate", async () => {
    return desktopPipController.activate();
  });

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

  ipcMain.handle("desktop:toggle-fullscreen", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    togglePlayerFullScreen();
    return true;
  });

  ipcMain.handle("desktop:exit-player-fullscreen", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    exitPlayerFullScreen();
    return true;
  });

  ipcMain.handle(
    "desktop:set-fullscreen",
    async (_event, fullscreen: boolean) => {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      setAppFullScreen(Boolean(fullscreen), "user");
      return true;
    },
  );

  ipcMain.handle("desktop:exit-fullscreen", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    setAppFullScreen(false, "user");
    return true;
  });

  ipcMain.handle("desktop:get-fullscreen-state", async () => {
    return isAppFullScreen();
  });

  ipcMain.handle("desktop:minimize-window", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (process.platform !== "win32" && mainWindow.isFullScreen()) {
      let timeoutId: NodeJS.Timeout | null = null;
      const onLeave = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.minimize();
        }
      };
      mainWindow.once("leave-full-screen", onLeave);
      timeoutId = setTimeout(() => {
        mainWindow?.removeListener("leave-full-screen", onLeave);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.minimize();
        }
      }, 600);
      setAppFullScreen(false, "user");
      return true;
    }
    mainWindow.minimize();
    return true;
  });

  ipcMain.handle("desktop:maximize-window", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (process.platform === "win32") {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
        if (lastNormalBounds) {
          const currentDisplay = screen.getDisplayMatching(lastNormalBounds);
          const workArea = currentDisplay?.workArea ?? {
            x: 0,
            y: 0,
            width: 1440,
            height: 900,
          };
          const width = Math.min(
            workArea.width,
            Math.max(960, lastNormalBounds.width),
          );
          const height = Math.min(
            workArea.height,
            Math.max(600, lastNormalBounds.height),
          );
          mainWindow.setBounds({
            x: Math.max(
              workArea.x,
              Math.min(lastNormalBounds.x, workArea.x + workArea.width - width),
            ),
            y: Math.max(
              workArea.y,
              Math.min(
                lastNormalBounds.y,
                workArea.y + workArea.height - height,
              ),
            ),
            width,
            height,
          });
        } else {
          const primaryDisplay = screen.getPrimaryDisplay();
          const workArea = primaryDisplay?.workArea ?? {
            width: 1440,
            height: 900,
          };
          const initialWidth = Math.min(
            1440,
            Math.max(960, Math.round(workArea.width * 0.85)),
          );
          const initialHeight = Math.min(
            900,
            Math.max(600, Math.round(workArea.height * 0.85)),
          );
          mainWindow.setSize(initialWidth, initialHeight);
          mainWindow.center();
        }
      } else {
        lastNormalBounds = mainWindow.getBounds();
        mainWindow.maximize();
      }
    } else {
      if (mainWindow.isFullScreen()) {
        setAppFullScreen(false, "user");
      } else if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
    return true;
  });

  ipcMain.handle("desktop:close-window", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    mainWindow.close();
    return true;
  });

  ipcMain.handle("desktop:is-maximized", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    return mainWindow.isMaximized();
  });

  torrentManager.subscribe(sendTorrentStatus);

  ipcMain.handle(
    "desktop:torrent-start",
    async (_event, request: TorrentStartRequest) => {
      if (!request || typeof request.sourceId !== "string") {
        throw new Error("invalid torrent start request");
      }
      await runStartupNativeWarmup();
      try {
        return await torrentManager.start(request);
      } catch (err) {
        // Enrich the error with diagnostic info so the renderer can surface
        // it in the UI with a Copy button — essential for prod debugging
        // where DevTools are not available.
        const original =
          err instanceof Error ? err.message : String(err ?? "unknown error");
        const debugLines = [
          `Error: ${original}`,
          `---`,
          `Platform : ${process.platform}-${process.arch}`,
          `App      : ${app.getVersion()}`,
          `Electron : ${process.versions.electron}`,
          `Node     : ${process.versions.node}`,
          `Warmup   : torrent=${torrentWarmupState.status}${torrentWarmupState.status === "error" ? ` (${(torrentWarmupState as { message?: string }).message ?? ""})` : ""}`,
        ];
        const enriched = new Error(debugLines.join("\n"));
        enriched.stack = err instanceof Error ? err.stack : undefined;
        throw enriched;
      }
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
      process.env.FRAMEZOO_TORRENT_DATA_DIR ||
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

    let maxBytes = 5 * 1024 * 1024 * 1024; // Default 5GB
    if (process.env.FRAMEZOO_TORRENT_MAX_SIZE_BYTES) {
      const parsed = parseInt(process.env.FRAMEZOO_TORRENT_MAX_SIZE_BYTES, 10);
      if (!isNaN(parsed)) maxBytes = parsed;
    }

    return {
      path: torrentDir,
      usedBytes: totalBytes,
      maxBytes,
    };
  });

  ipcMain.handle(
    "desktop:set-torrent-max-size",
    async (_event, size: string | null) => {
      if (size) {
        process.env.FRAMEZOO_TORRENT_MAX_SIZE_BYTES = size;
      } else {
        delete process.env.FRAMEZOO_TORRENT_MAX_SIZE_BYTES;
      }
      return true;
    },
  );

  ipcMain.handle("desktop:torrent-clear-storage", async () => {
    const torrentDir =
      process.env.FRAMEZOO_TORRENT_DATA_DIR ||
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

  // Warmup IPC: renderer can query the current warmup state or trigger a
  // manual re-warmup (e.g. after the user grants network permission).
  ipcMain.handle("desktop:torrent-warmup-state", () => torrentWarmupState);
  ipcMain.handle("desktop:torrent-warmup", async () => {
    await runTorrentWarmup();
    return torrentWarmupState;
  });
  ipcMain.handle("desktop:native-warmup-state", () => getStartupWarmupState());
  ipcMain.handle("desktop:native-warmup-wait", async () => {
    await runStartupNativeWarmup();
    return getStartupWarmupState();
  });
}

app.on("before-quit", () => {
  moonshineNodeRuntime.close();
});

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("enable-features", "DocumentPictureInPictureAPI");
app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling");

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine) => {
    if (!mainWindow) return;

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();

    const deepLinkUrl = commandLine.find((arg) =>
      arg.startsWith(`${PROTOCOL_PREFIX}:/`),
    );
    if (deepLinkUrl) {
      handleDeepLink(deepLinkUrl);
    }
  });

  app.whenReady().then(() => {
    registerRendererProtocol();
    registerIpcHandlers();
    registerHeaderInterceptors();
    installApplicationMenu();
    createMainWindow();
    void runStartupNativeWarmup();
    desktopAppUpdater.initialize();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });

    const deepLinkUrl = process.argv.find((arg) =>
      arg.startsWith(`${PROTOCOL_PREFIX}:/`),
    );
    if (deepLinkUrl) {
      setTimeout(() => handleDeepLink(deepLinkUrl), 1500);
    }
  });
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (app.isReady()) {
    handleDeepLink(url);
  } else {
    app.whenReady().then(() => {
      setTimeout(() => handleDeepLink(url), 1500);
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

let isQuitting = false;
app.on("before-quit", (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  desktopAppUpdater.dispose();
  torrentManager
    .stopAll()
    .catch(console.error)
    .finally(() => {
      void torrentManager.dispose().finally(() => {
        app.quit();
      });
    });
});
