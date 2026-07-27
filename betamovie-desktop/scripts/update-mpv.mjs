import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import AdmZip from "adm-zip";
import { fileURLToPath } from "url";

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESOURCES_BIN = path.join(ROOT_DIR, "..", "resources", "bin");
const TMP_DIR = path.join(RESOURCES_BIN, ".tmp_mpv_download");
const DEFAULT_VERSION_TAG = "v0.41.0";
const SUPPORTED_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "win32-arm64",
  "win32-x64",
];

// Default release fallback URLs if API fails
const DEFAULT_ASSETS_V41 = {
  "darwin-arm64": {
    url: "https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-macos-14-arm.zip",
    type: "mac-tar",
  },
  "darwin-x64": {
    url: "https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-macos-15-intel.zip",
    type: "mac-tar",
  },
  "win32-x64": {
    url: "https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-x86_64-pc-windows-msvc.zip",
    type: "win-zip",
  },
  "win32-arm64": {
    url: "https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-aarch64-pc-windows-msvc.zip",
    type: "win-zip",
  },
};

async function getReleaseAssets(versionTag = "v0.41.0") {
  console.log(
    `[mpv-update] Fetching release asset links for MPV ${versionTag} from GitHub...`,
  );
  try {
    const res = await fetch(
      `https://api.github.com/repos/mpv-player/mpv/releases/tags/${versionTag}`,
      { headers: { "User-Agent": "BetaMovie-MPV-Updater" } },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const assets = {};

    for (const asset of data.assets || []) {
      const name = asset.name.toLowerCase();
      if (
        name.includes("macos") &&
        (name.includes("arm") || name.includes("aarch64"))
      ) {
        // Pick the broadest compatible macOS ARM build if available
        if (!assets["darwin-arm64"] || name.includes("14")) {
          assets["darwin-arm64"] = {
            url: asset.browser_download_url,
            type: "mac-tar",
          };
        }
      } else if (
        name.includes("macos") &&
        (name.includes("intel") || name.includes("x86_64"))
      ) {
        assets["darwin-x64"] = {
          url: asset.browser_download_url,
          type: "mac-tar",
        };
      } else if (name.includes("windows-msvc") && name.includes("x86_64")) {
        assets["win32-x64"] = {
          url: asset.browser_download_url,
          type: "win-zip",
        };
      } else if (name.includes("windows-msvc") && name.includes("aarch64")) {
        assets["win32-arm64"] = {
          url: asset.browser_download_url,
          type: "win-zip",
        };
      }
    }

    return versionTag === DEFAULT_VERSION_TAG
      ? { ...DEFAULT_ASSETS_V41, ...assets }
      : assets;
  } catch (err) {
    if (versionTag !== DEFAULT_VERSION_TAG) {
      throw err;
    }
    console.warn(
      `[mpv-update] Could not fetch GitHub API (${err.message}). Using fallback URLs for ${DEFAULT_VERSION_TAG}.`,
    );
    return DEFAULT_ASSETS_V41;
  }
}

async function downloadFile(url, destPath) {
  console.log(`[mpv-update] Downloading: ${url}`);
  const response = await fetch(url, {
    headers: { "User-Agent": "BetaMovie-MPV-Updater" },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
  console.log(
    `[mpv-update] Saved ${(arrayBuffer.byteLength / (1024 * 1024)).toFixed(2)} MB to ${path.basename(destPath)}`,
  );
}

function copyFolderRecursiveSync(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  const files = fs.readdirSync(source);
  for (const file of files) {
    const curSource = path.join(source, file);
    const curTarget = path.join(target, file);
    if (fs.lstatSync(curSource).isDirectory()) {
      copyFolderRecursiveSync(curSource, curTarget);
    } else {
      fs.copyFileSync(curSource, curTarget);
    }
  }
}

async function updateTarget(platformArch, info) {
  const targetDir = path.join(RESOURCES_BIN, platformArch);
  console.log(`\n========================================`);
  console.log(`[mpv-update] Updating target: ${platformArch}`);
  console.log(`========================================`);

  const tmpWorkDir = path.join(TMP_DIR, platformArch);
  if (fs.existsSync(tmpWorkDir))
    fs.rmSync(tmpWorkDir, { recursive: true, force: true });
  fs.mkdirSync(tmpWorkDir, { recursive: true });

  const zipFile = path.join(tmpWorkDir, "package.zip");
  await downloadFile(info.url, zipFile);

  console.log(`[mpv-update] Extracting zip...`);
  const zip = new AdmZip(zipFile);
  const extractDir = path.join(tmpWorkDir, "unzipped");
  zip.extractAllTo(extractDir, true);

  // Clean target directory before inserting new version
  if (fs.existsSync(targetDir))
    fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  if (info.type === "mac-tar") {
    const tarGz = path.join(extractDir, "mpv.tar.gz");
    if (!fs.existsSync(tarGz)) {
      throw new Error(
        `Expected mpv.tar.gz inside mac release zip for ${platformArch}`,
      );
    }
    const tarOut = path.join(tmpWorkDir, "tar-out");
    fs.mkdirSync(tarOut, { recursive: true });
    console.log(`[mpv-update] Extracting tar.gz...`);
    execSync(`tar -xzf "${tarGz}" -C "${tarOut}"`, { stdio: "inherit" });

    const macOsBinDir = path.join(tarOut, "mpv.app", "Contents", "MacOS");
    if (!fs.existsSync(macOsBinDir)) {
      throw new Error(
        `Could not find mpv.app/Contents/MacOS in extracted bundle`,
      );
    }
    console.log(`[mpv-update] Installing binaries into ${targetDir}...`);
    copyFolderRecursiveSync(macOsBinDir, targetDir);

    const mpvBin = path.join(targetDir, "mpv");
    if (fs.existsSync(mpvBin) && process.platform !== "win32") {
      fs.chmodSync(mpvBin, 0o755);
      console.log(
        `[mpv-update] Applied +x executable permissions to ${mpvBin}`,
      );
    }
  } else if (info.type === "win-zip") {
    console.log(
      `[mpv-update] Installing Windows binaries into ${targetDir} (excluding heavy .pdb symbol files)...`,
    );
    const items = fs.readdirSync(extractDir);
    for (const item of items) {
      if (item.endsWith(".pdb")) {
        console.log(`[mpv-update] Skipping debug file: ${item}`);
        continue;
      }
      const srcPath = path.join(extractDir, item);
      const destPath = path.join(targetDir, item);
      if (fs.lstatSync(srcPath).isDirectory()) {
        copyFolderRecursiveSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  console.log(`[mpv-update] Target ${platformArch} updated successfully!`);
}

function getBinaryName(platformArch) {
  return platformArch.startsWith("win32-") ? "mpv.exe" : "mpv";
}

function hasInstalledBinary(platformArch) {
  return fs.existsSync(
    path.join(RESOURCES_BIN, platformArch, getBinaryName(platformArch)),
  );
}

function parseArgs(args) {
  const targetIndex = args.indexOf("--target");
  const target = targetIndex >= 0 ? args[targetIndex + 1] : undefined;
  const versionIndex = args.indexOf("--version");

  return {
    ensure: args.includes("--ensure"),
    host: args.includes("--host"),
    target,
    versionTag:
      versionIndex >= 0 && args[versionIndex + 1]
        ? args[versionIndex + 1]
        : DEFAULT_VERSION_TAG,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const requestedTargets = options.target
    ? [options.target]
    : options.host
      ? [`${process.platform}-${process.arch}`]
      : null;

  if (options.target && !SUPPORTED_TARGETS.includes(options.target)) {
    throw new Error(
      `Unsupported MPV target. Expected darwin-arm64, darwin-x64, win32-arm64, or win32-x64.`,
    );
  }
  if (options.host && !SUPPORTED_TARGETS.includes(requestedTargets[0])) {
    console.warn(
      `[mpv-update] No bundled MPV asset for host target ${requestedTargets[0]}. Falling back to system MPV.`,
    );
    return;
  }

  if (!fs.existsSync(RESOURCES_BIN)) {
    fs.mkdirSync(RESOURCES_BIN, { recursive: true });
  }
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  try {
    const initialTargets = requestedTargets ?? Object.keys(DEFAULT_ASSETS_V41);
    const targetsToInstall = options.ensure
      ? initialTargets.filter((target) => !hasInstalledBinary(target))
      : initialTargets;

    if (targetsToInstall.length === 0) {
      console.log("[mpv-update] Required MPV resources already exist.");
      return;
    }

    const assets = await getReleaseAssets(options.versionTag);
    const unsupportedTargets = targetsToInstall.filter(
      (target) => !assets[target],
    );
    if (unsupportedTargets.length > 0) {
      if (options.host && !options.target) {
        console.warn(
          `[mpv-update] No bundled MPV asset for host target ${unsupportedTargets.join(", ")}. Falling back to system MPV.`,
        );
        return;
      }
      throw new Error(
        `Missing MPV release assets for: ${unsupportedTargets.join(", ")}`,
      );
    }

    console.log(
      `[mpv-update] Will update targets: ${targetsToInstall.join(", ")}`,
    );

    for (const target of targetsToInstall) {
      await updateTarget(target, assets[target]);
    }

    console.log(
      `\n[mpv-update] All requested MPV binaries are ready for ${options.versionTag}!`,
    );
  } finally {
    if (fs.existsSync(TMP_DIR)) {
      console.log(`[mpv-update] Cleaning up temporary download caches...`);
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(`[mpv-update] Fatal error:`, err);
  process.exit(1);
});
