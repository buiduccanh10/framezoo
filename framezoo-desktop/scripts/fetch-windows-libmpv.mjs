import crypto from "node:crypto";
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
const defaultOutDir = path.join(
  process.cwd(),
  "resources",
  "libmpv-sdk",
  target,
);
const outDir = path.resolve(getArg("--out", defaultOutDir));

if (!target.startsWith("win32-")) {
  console.log(
    "[fetch-windows-libmpv] Target " + target + " is not a Windows target. Skipping.",
  );
  process.exit(0);
}

const pinnedAssets = {
  "win32-x64": {
    name: "mpv-dev-x86_64-v3-20261001-git-3186d369f9.7z",
    url: "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261001/mpv-dev-x86_64-v3-20261001-git-3186d369f9.7z",
    sha256:
      "f5ede11adaa383d13efbb7c711032e4b44d4126e4390eb746e35725348cbb592",
  },
  "win32-arm64": {
    name: "mpv-dev-aarch64-20261001-git-3186d369f9.7z",
    url: "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261001/mpv-dev-aarch64-20261001-git-3186d369f9.7z",
    sha256:
      "0d12fa1fe3bfa19265ffcfc00ec5d90da1972dbde2b36596803bbdcecdc5b6f8",
  },
};

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

function isSdkComplete(root) {
  return (
    fs.existsSync(path.join(root, "include", "mpv", "client.h")) &&
    (fs.existsSync(path.join(root, "libmpv-2.dll")) ||
      fs.existsSync(path.join(root, "mpv-2.dll")))
  );
}

function publishLibmpvRoot(libmpvRoot) {
  console.log("[fetch-windows-libmpv] SDK Ready at: " + libmpvRoot);
  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(
      process.env.GITHUB_ENV,
      "LIBMPV_ROOT=" + libmpvRoot + "\n",
      "utf8",
    );
    console.log(
      "[fetch-windows-libmpv] Appended LIBMPV_ROOT=" +
        libmpvRoot +
        " to GITHUB_ENV",
    );
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const cachedRoot = findMpvRoot(outDir);
  if (isSdkComplete(cachedRoot)) {
    console.log(
      "[fetch-windows-libmpv] Using cached libmpv SDK at " +
        cachedRoot +
        " (skipping download)",
    );
    publishLibmpvRoot(cachedRoot);
    return;
  }

  const asset = pinnedAssets[target];
  if (!asset) {
    throw new Error(
      "[fetch-windows-libmpv] No pinned libmpv dev asset for target " + target,
    );
  }
  const tmpFile = path.join(os.tmpdir(), "mpv-sdk-" + Date.now() + "-" + asset.name);

  console.log("[fetch-windows-libmpv] Downloading " + asset.url + "...");
  const downloadRes = await fetch(asset.url, {
    headers: { "User-Agent": "Framezoo-Build-Script" },
  });
  if (!downloadRes.ok) {
    throw new Error(
      "Failed to download " +
        asset.url +
        ": " +
        downloadRes.status +
        " " +
        downloadRes.statusText,
    );
  }
  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  const digest = crypto.createHash("sha256").update(buffer).digest("hex");
  if (digest !== asset.sha256) {
    throw new Error(
      "[fetch-windows-libmpv] SHA-256 mismatch for " +
        asset.name +
        ": expected " +
        asset.sha256 +
        ", got " +
        digest,
    );
  }
  fs.writeFileSync(tmpFile, buffer);
  console.log(
    "[fetch-windows-libmpv] Saved temporary archive (" +
      (buffer.length / 1024 / 1024).toFixed(2) +
      " MB) to " +
      tmpFile,
  );

  console.log(
    "[fetch-windows-libmpv] Extracting archive using 7z to " + outDir + "...",
  );
  try {
    execFileSync("7z", ["x", "-y", "-o" + outDir, tmpFile], {
      stdio: "inherit",
    });
  } catch (error) {
    throw new Error(
      "Failed to extract archive using '7z'. Ensure 7-Zip (7z) is installed and in PATH. Details: " +
        error.message,
    );
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }

  publishLibmpvRoot(findMpvRoot(outDir));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
