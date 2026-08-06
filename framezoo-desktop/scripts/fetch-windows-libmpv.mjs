import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

const target = getArg("--target", "win32-x64");
const defaultOutDir = path.join(process.cwd(), "resources", "libmpv-sdk", target);
const outDir = path.resolve(getArg("--out", defaultOutDir));

if (!target.startsWith("win32-")) {
  console.log(`[fetch-windows-libmpv] Target ${target} is not a Windows target. Skipping.`);
  process.exit(0);
}

const pattern =
  target === "win32-arm64"
    ? /^mpv-dev-aarch64-[0-9].*\.7z$/i
    : /^mpv-dev-x86_64-[0-9].*\.7z$/i;

const fallbackPattern =
  target === "win32-x64" ? /^mpv-dev-x86_64-v3-[0-9].*\.7z$/i : pattern;

const candidateRepos = [
  "https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases?per_page=5",
  "https://api.github.com/repos/zhongfly/mpv-winbuild/releases?per_page=5",
];

async function fetchReleaseAsset() {
  const headers = { "User-Agent": "FrameZoo-Build-Script" };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  for (const apiUrl of candidateRepos) {
    console.log(`[fetch-windows-libmpv] Checking repository: ${apiUrl}`);
    try {
      const res = await fetch(apiUrl, { headers });
      if (!res.ok) {
        console.warn(`[fetch-windows-libmpv] Failed to query ${apiUrl}: ${res.status} ${res.statusText}`);
        continue;
      }
      const releases = await res.json();
      if (!Array.isArray(releases)) continue;

      for (const release of releases) {
        if (!release.assets || !Array.isArray(release.assets)) continue;
        const asset = release.assets.find((a) => pattern.test(a.name)) || release.assets.find((a) => fallbackPattern.test(a.name));
        if (asset) {
          console.log(`[fetch-windows-libmpv] Found asset: ${asset.name} (${asset.browser_download_url})`);
          return asset;
        }
      }
    } catch (error) {
      console.warn(`[fetch-windows-libmpv] Error checking ${apiUrl}:`, error.message);
    }
  }
  throw new Error(`[fetch-windows-libmpv] Could not find suitable prebuilt libmpv dev asset for target ${target}`);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const asset = await fetchReleaseAsset();
  const tmpFile = path.join(os.tmpdir(), `mpv-sdk-${Date.now()}-${asset.name}`);

  console.log(`[fetch-windows-libmpv] Downloading ${asset.browser_download_url}...`);
  const downloadRes = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "FrameZoo-Build-Script" },
  });
  if (!downloadRes.ok) {
    throw new Error(`Failed to download ${asset.browser_download_url}: ${downloadRes.status} ${downloadRes.statusText}`);
  }
  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  fs.writeFileSync(tmpFile, buffer);
  console.log(`[fetch-windows-libmpv] Saved temporary archive (${(buffer.length / 1024 / 1024).toFixed(2)} MB) to ${tmpFile}`);

  console.log(`[fetch-windows-libmpv] Extracting archive using 7z to ${outDir}...`);
  try {
    execFileSync("7z", ["x", "-y", `-o${outDir}`, tmpFile], { stdio: "inherit" });
  } catch (error) {
    throw new Error(`Failed to extract archive using '7z'. Ensure 7-Zip (7z) is installed and in PATH. Details: ${error.message}`);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }

  function findMpvRoot(directory) {
    if (
      fs.existsSync(path.join(directory, "include", "mpv", "client.h")) ||
      fs.existsSync(path.join(directory, "libmpv-2.dll")) ||
      fs.existsSync(path.join(directory, "mpv-2.dll")) ||
      fs.existsSync(path.join(directory, "lib", "libmpv.dll.a"))
    ) {
      return directory;
    }
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sub = path.join(directory, entry.name);
        if (
          fs.existsSync(path.join(sub, "include")) ||
          fs.existsSync(path.join(sub, "libmpv-2.dll")) ||
          fs.existsSync(path.join(sub, "mpv-2.dll")) ||
          fs.existsSync(path.join(sub, "lib", "libmpv.dll.a"))
        ) {
          return sub;
        }
      }
    }
    return directory;
  }

  const libmpvRoot = findMpvRoot(outDir);
  console.log(`[fetch-windows-libmpv] SDK Ready at: ${libmpvRoot}`);

  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV, `LIBMPV_ROOT=${libmpvRoot}\n`, "utf8");
    console.log(`[fetch-windows-libmpv] Appended LIBMPV_ROOT=${libmpvRoot} to GITHUB_ENV`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
