import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type {
  CreateDesktopAppUpdaterOptions,
  DesktopAppUpdateState,
} from "./types";

const INITIAL_DESKTOP_APP_UPDATE_STATE: DesktopAppUpdateState = {
  status: "idle",
  updateToken: null,
  updateVersion: null,
  progressPercent: null,
  errorMessage: null,
};

async function downloadHttpsFile(
  url: string,
  destinationPath: string,
  onProgress: (percent: number | null) => void,
  redirectCount = 0,
): Promise<void> {
  if (redirectCount > 5) {
    throw new Error("Too many redirects while downloading desktop update");
  }

  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = https.get(url, resolve);
    request.setTimeout(30_000, () => {
      request.destroy(new Error("Desktop update download timed out"));
    });
    request.on("error", reject);
  });

  const location = response.headers.location;
  if (
    response.statusCode &&
    response.statusCode >= 300 &&
    response.statusCode < 400 &&
    location
  ) {
    response.resume();
    const redirectUrl = new URL(location, url);
    if (redirectUrl.protocol !== "https:") {
      throw new Error("Desktop update redirect is not HTTPS");
    }

    await downloadHttpsFile(
      redirectUrl.toString(),
      destinationPath,
      onProgress,
      redirectCount + 1,
    );
    return;
  }

  if (response.statusCode !== 200) {
    response.resume();
    throw new Error(`Failed to download update: ${response.statusCode}`);
  }

  const totalBytes = parseInt(
    String(response.headers["content-length"] ?? "0"),
    10,
  );
  let downloadedBytes = 0;
  response.on("data", (chunk: Buffer) => {
    downloadedBytes += chunk.length;
    onProgress(
      totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : null,
    );
  });

  try {
    await pipeline(response, fs.createWriteStream(destinationPath));
  } catch (error) {
    await fs.promises.rm(destinationPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function verifyReleaseAsset(
  manifestUrl: string,
  assetName: string,
  assetPath: string,
  manifestPath: string,
): Promise<void> {
  await downloadHttpsFile(manifestUrl, manifestPath, () => {});
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  const expected = manifest.files?.find(
    (file: { fileName?: string; sha256?: string }) =>
      file.fileName === assetName && typeof file.sha256 === "string",
  )?.sha256;
  if (!expected) {
    throw new Error(`No trusted checksum found for desktop update asset ${assetName}`);
  }

  const actual = createHash("sha256")
    .update(await fs.promises.readFile(assetPath))
    .digest("hex");
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Desktop update checksum mismatch for ${assetName}`);
  }
}

export function createDesktopAppUpdater(
  options: CreateDesktopAppUpdaterOptions,
) {
  const tempFilePrefix = options.appName.replace(/\s+/g, "") || "DesktopApp";
  let hasInitialized = false;
  let updateInterval: NodeJS.Timeout | null = null;
  let state: DesktopAppUpdateState = { ...INITIAL_DESKTOP_APP_UPDATE_STATE };

  function getFeedUrl() {
    return `https://github.com/${options.releaseOwner}/${options.releaseRepo}/releases/latest/download/`;
  }

  function isSupported() {
    return process.platform === "darwin" || process.platform === "win32";
  }

  function setState(nextState: Partial<DesktopAppUpdateState>) {
    state = {
      ...state,
      ...nextState,
    };
    options.onStateChange?.({ ...state });
  }

  async function checkForUpdate() {
    if (!app.isPackaged || !isSupported()) return false;

    setState({
      status: "checking",
      progressPercent: null,
      errorMessage: null,
    });

    try {
      await autoUpdater.checkForUpdates();
      return (
        state.status === "available" ||
        state.status === "downloading" ||
        state.status === "downloaded"
      );
    } catch (error) {
      setState({
        status: "error",
        progressPercent: null,
        errorMessage:
          error instanceof Error ? error.message : "Unknown update error",
      });
      return false;
    }
  }

  async function downloadUpdate() {
    if (!app.isPackaged || !isSupported()) return false;

    setState({
      status: "downloading",
      progressPercent: 0,
      errorMessage: null,
    });

    try {
      if (process.platform === "darwin") {
        const version = state.updateVersion;
        if (!version) throw new Error("No update version available");

        const arch = process.arch === "arm64" ? "arm64" : "x64";
        const zipFileName = `${options.appName}-${version}-${arch}-mac.zip`;
        const downloadUrl = new URL(
          encodeURIComponent(zipFileName),
          getFeedUrl(),
        ).toString();
        const tempZipPath = path.join(
          os.tmpdir(),
          `${tempFilePrefix}-update.zip`,
        );
        const tempManifestPath = path.join(
          os.tmpdir(),
          `${tempFilePrefix}-update-manifest.json`,
        );

        await fs.promises.rm(tempZipPath, { force: true });
        await fs.promises.rm(tempManifestPath, { force: true });
        await downloadHttpsFile(downloadUrl, tempZipPath, (progressPercent) => {
          setState({
            status: "downloading",
            progressPercent,
            errorMessage: null,
          });
        });
        await verifyReleaseAsset(
          new URL("manifest.json", getFeedUrl()).toString(),
          zipFileName,
          tempZipPath,
          tempManifestPath,
        );
        await fs.promises.rm(tempManifestPath, { force: true });

        setState({
          status: "downloaded",
          updateToken: version,
          updateVersion: version,
          progressPercent: 100,
          errorMessage: null,
        });
        return true;
      }

      await autoUpdater.downloadUpdate();
      return true;
    } catch (error) {
      if (process.platform === "darwin") {
        await fs.promises
          .rm(path.join(os.tmpdir(), `${tempFilePrefix}-update.zip`), {
            force: true,
          })
          .catch(() => {});
        await fs.promises
          .rm(path.join(os.tmpdir(), `${tempFilePrefix}-update-manifest.json`), {
            force: true,
          })
          .catch(() => {});
      }
      setState({
        status: "available",
        progressPercent: null,
        errorMessage:
          error instanceof Error ? error.message : "Failed to download update",
      });
      return false;
    }
  }

  async function installUpdate() {
    if (!app.isPackaged || !isSupported()) return false;
    if (state.status !== "downloaded") return false;

    // Let the updater own shutdown while cleanup is still asynchronous.
    (global as any).isUpdating = true;
    try {
      await options.beforeInstall?.();
    } catch (error) {
      console.error("[updater] Error during beforeInstall cleanup:", error);
    }

    if (process.platform === "darwin") {
      const zipPath = path.join(os.tmpdir(), `${tempFilePrefix}-update.zip`);
      const scriptPath = path.join(os.tmpdir(), `${tempFilePrefix}-updater.sh`);

      let appPath = process.execPath;
      if (appPath.includes(".app/Contents/MacOS/")) {
        appPath = appPath.substring(0, appPath.indexOf(".app") + 4);
      } else {
        appPath = `/Applications/${options.appName}.app`;
      }

      const scriptContent = `#!/bin/bash
set -euo pipefail
sleep 2
USER_TORRENTS_DIR="$HOME/Library/Application Support/${options.appName}/torrents"
mkdir -p "$USER_TORRENTS_DIR"
if [ -d "${appPath}/Contents/Resources/torrents" ]; then
  cp -Rn "${appPath}/Contents/Resources/torrents/"* "$USER_TORRENTS_DIR/" 2>/dev/null || true
fi
if [ -d "${appPath}/Contents/Resources/torrent-engine/torrents" ]; then
  cp -Rn "${appPath}/Contents/Resources/torrent-engine/torrents/"* "$USER_TORRENTS_DIR/" 2>/dev/null || true
fi
if [ -d "${appPath}/torrents" ]; then
  cp -Rn "${appPath}/torrents/"* "$USER_TORRENTS_DIR/" 2>/dev/null || true
fi
CURRENT_TEAM_ID=$(/usr/bin/codesign -dv --verbose=4 "${appPath}" 2>&1 | sed -n 's/^TeamIdentifier=//p') || true
[ "$CURRENT_TEAM_ID" = "not set" ] && CURRENT_TEAM_ID=""
STAGING_DIR=$(mktemp -d "${path.dirname(appPath)}/.${tempFilePrefix}-update.XXXXXX")
trap 'rm -rf "$STAGING_DIR"' EXIT
unzip -Z1 "${zipPath}" | while IFS= read -r entry; do
  case "$entry" in
    /*|../*|*/../*|*/..)
      echo "Unsafe path in desktop update archive" >&2
      exit 1
      ;;
  esac
done
unzip -q -o "${zipPath}" -d "$STAGING_DIR"
STAGED_APP="$STAGING_DIR/$(basename "${appPath}")"
[ -d "$STAGED_APP" ] || exit 1
/usr/bin/codesign --verify --deep --strict --verbose=2 "$STAGED_APP"
if [ -n "$CURRENT_TEAM_ID" ]; then
  STAGED_TEAM_ID=$(/usr/bin/codesign -dv --verbose=4 "$STAGED_APP" 2>&1 | sed -n 's/^TeamIdentifier=//p') || true
  [ "$STAGED_TEAM_ID" = "not set" ] && STAGED_TEAM_ID=""
  [ "$STAGED_TEAM_ID" = "$CURRENT_TEAM_ID" ] || exit 1
fi
rm -rf "${appPath}"
mv "$STAGED_APP" "${appPath}"
open "${appPath}"
`;

      fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

      spawn("bash", [scriptPath], {
        detached: true,
        stdio: "ignore",
      }).unref();
      app.quit();
      return true;
    }

    autoUpdater.quitAndInstall(true, true);
    return true;
  }

  function initialize() {
    if (hasInitialized) return;
    hasInitialized = true;

    if (!app.isPackaged || !isSupported()) {
      return;
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.setFeedURL({
      provider: "generic",
      url: getFeedUrl(),
    });

    autoUpdater.on("checking-for-update", () => {
      setState({
        status: "checking",
        progressPercent: null,
        errorMessage: null,
      });
    });

    autoUpdater.on("update-available", (info: any) => {
      setState({
        status: "available",
        updateToken: info?.version ?? app.getVersion(),
        updateVersion: info?.version ?? app.getVersion(),
        progressPercent: null,
        errorMessage: null,
      });
    });

    autoUpdater.on("update-not-available", () => {
      setState({
        status: "idle",
        updateToken: null,
        updateVersion: null,
        progressPercent: null,
        errorMessage: null,
      });
    });

    autoUpdater.on("download-progress", (progress: any) => {
      setState({
        status: "downloading",
        progressPercent:
          typeof progress?.percent === "number" ? progress.percent : null,
        errorMessage: null,
      });
    });

    autoUpdater.on("update-downloaded", (info: any) => {
      setState({
        status: "downloaded",
        updateToken: info?.version ?? state.updateToken,
        updateVersion: info?.version ?? state.updateVersion,
        progressPercent: 100,
        errorMessage: null,
      });
    });

    autoUpdater.on("error", (error) => {
      setState({
        status:
          state.updateToken && state.status !== "idle" ? "available" : "error",
        progressPercent: null,
        errorMessage: error?.message ?? "Desktop update failed",
      });
    });

    setTimeout(() => {
      void checkForUpdate();
    }, 5000);

    updateInterval = setInterval(() => {
      void checkForUpdate();
    }, options.checkIntervalMs);
  }

  function dispose() {
    if (!updateInterval) return;
    clearInterval(updateInterval);
    updateInterval = null;
  }

  return {
    checkForUpdate,
    dispose,
    downloadUpdate,
    getState() {
      return { ...state };
    },
    initialize,
    installUpdate,
  };
}
