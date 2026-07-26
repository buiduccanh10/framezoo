import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import AdmZip from "adm-zip";

const ROOT_DIR = process.cwd();
const RESOURCES_BIN = path.join(ROOT_DIR, "resources", "bin");
const TMP_DIR = path.join(RESOURCES_BIN, ".tmp_mpv_download");

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
  console.log(`[mpv-update] Fetching release asset links for MPV ${versionTag} from GitHub...`);
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
      if (name.includes("macos") && (name.includes("arm") || name.includes("aarch64"))) {
        // Pick the broadest compatible macOS ARM build if available
        if (!assets["darwin-arm64"] || name.includes("14")) {
          assets["darwin-arm64"] = { url: asset.browser_download_url, type: "mac-tar" };
        }
      } else if (name.includes("macos") && (name.includes("intel") || name.includes("x86_64"))) {
        assets["darwin-x64"] = { url: asset.browser_download_url, type: "mac-tar" };
      } else if (name.includes("windows-msvc") && name.includes("x86_64")) {
        assets["win32-x64"] = { url: asset.browser_download_url, type: "win-zip" };
      } else if (name.includes("windows-msvc") && name.includes("aarch64")) {
        assets["win32-arm64"] = { url: asset.browser_download_url, type: "win-zip" };
      }
    }

    if (Object.keys(assets).length === 0 && versionTag === "v0.41.0") {
      return DEFAULT_ASSETS_V41;
    }
    return assets;
  } catch (err) {
    console.warn(`[mpv-update] Could not fetch GitHub API (${err.message}). Using fallback URLs for v0.41.0.`);
    return DEFAULT_ASSETS_V41;
  }
}

async function downloadFile(url, destPath) {
  console.log(`[mpv-update] Downloading: ${url}`);
  const response = await fetch(url, {
    headers: { "User-Agent": "BetaMovie-MPV-Updater" },
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
  console.log(`[mpv-update] Saved ${(arrayBuffer.byteLength / (1024 * 1024)).toFixed(2)} MB to ${path.basename(destPath)}`);
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
  if (fs.existsSync(tmpWorkDir)) fs.rmSync(tmpWorkDir, { recursive: true, force: true });
  fs.mkdirSync(tmpWorkDir, { recursive: true });

  const zipFile = path.join(tmpWorkDir, "package.zip");
  await downloadFile(info.url, zipFile);

  console.log(`[mpv-update] Extracting zip...`);
  const zip = new AdmZip(zipFile);
  const extractDir = path.join(tmpWorkDir, "unzipped");
  zip.extractAllTo(extractDir, true);

  // Clean target directory before inserting new version
  if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  if (info.type === "mac-tar") {
    const tarGz = path.join(extractDir, "mpv.tar.gz");
    if (!fs.existsSync(tarGz)) {
      throw new Error(`Expected mpv.tar.gz inside mac release zip for ${platformArch}`);
    }
    const tarOut = path.join(tmpWorkDir, "tar-out");
    fs.mkdirSync(tarOut, { recursive: true });
    console.log(`[mpv-update] Extracting tar.gz...`);
    execSync(`tar -xzf "${tarGz}" -C "${tarOut}"`, { stdio: "inherit" });

    const macOsBinDir = path.join(tarOut, "mpv.app", "Contents", "MacOS");
    if (!fs.existsSync(macOsBinDir)) {
      throw new Error(`Could not find mpv.app/Contents/MacOS in extracted bundle`);
    }
    console.log(`[mpv-update] Installing binaries into ${targetDir}...`);
    copyFolderRecursiveSync(macOsBinDir, targetDir);

    const mpvBin = path.join(targetDir, "mpv");
    if (fs.existsSync(mpvBin) && process.platform !== "win32") {
      fs.chmodSync(mpvBin, 0o755);
      console.log(`[mpv-update] Applied +x executable permissions to ${mpvBin}`);
    }
  } else if (info.type === "win-zip") {
    console.log(`[mpv-update] Installing Windows binaries into ${targetDir} (excluding heavy .pdb symbol files)...`);
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

async function main() {
  const args = process.argv.slice(2);
  let versionTag = "v0.41.0";
  const verIdx = args.indexOf("--version");
  if (verIdx !== -1 && args[verIdx + 1]) {
    versionTag = args[verIdx + 1];
  }

  if (!fs.existsSync(RESOURCES_BIN)) {
    fs.mkdirSync(RESOURCES_BIN, { recursive: true });
  }
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  try {
    const assets = await getReleaseAssets(versionTag);
    const targets = Object.keys(assets);
    console.log(`[mpv-update] Will update targets: ${targets.join(", ")}`);

    for (const target of targets) {
      await updateTarget(target, assets[target]);
    }

    console.log(`\n[mpv-update] All target MPV binaries have been successfully upgraded to ${versionTag}!`);
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
