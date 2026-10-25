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
    name: "mpv-dev-x86_64-20261001-git-3186d369f9.7z",
    url: "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261001/mpv-dev-x86_64-20261001-git-3186d369f9.7z",
    sha256:
      "de0aa24a39e27b07d9f663616f8d09c91586c7328d8c33fbfbc8e3888c35d89c",
    dllSha256:
      "ec77593d23735f36eb08e486154e89cf1cc6a5650327dab125736c1bb5d3af40",
  },
  "win32-arm64": {
    name: "mpv-dev-aarch64-20261001-git-3186d369f9.7z",
    url: "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261001/mpv-dev-aarch64-20261001-git-3186d369f9.7z",
    sha256:
      "0d12fa1fe3bfa19265ffcfc00ec5d90da1972dbde2b36596803bbdcecdc5b6f8",
    dllSha256:
      "820ba5b5259d9db0ef37cc16248c3986c390db113b9adddd58021b15057d40ed",
  },
};

function getFileSha256(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
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

function isSdkComplete(root, asset) {
  if (!fs.existsSync(path.join(root, "include", "mpv", "client.h"))) {
    return false;
  }
  const dllNames = ["libmpv-2.dll", "mpv-2.dll"];
  let foundDllPath = null;
  for (const name of dllNames) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) {
      foundDllPath = candidate;
      break;
    }
  }
  if (!foundDllPath) return false;

  if (asset?.dllSha256) {
    const actualSha = getFileSha256(foundDllPath);
    if (actualSha !== asset.dllSha256) {
      console.warn(
        `[fetch-windows-libmpv] Cached libmpv DLL sha256 mismatch at ${foundDllPath}: expected ${asset.dllSha256}, got ${actualSha}`,
      );
      return false;
    }
  }
  return true;
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

  const asset = pinnedAssets[target];
  if (!asset) {
    throw new Error(
      "[fetch-windows-libmpv] No pinned libmpv dev asset for target " + target,
    );
  }

  const cachedRoot = findMpvRoot(outDir);
  if (isSdkComplete(cachedRoot, asset)) {
    console.log(
      "[fetch-windows-libmpv] Using verified cached libmpv SDK at " +
        cachedRoot +
        " (skipping download)",
    );
    publishLibmpvRoot(cachedRoot);
    return;
  }

  if (fs.existsSync(outDir)) {
    console.log(
      "[fetch-windows-libmpv] Stale/invalid SDK detected. Cleaning " +
        outDir +
        "...",
    );
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
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

  const extractedRoot = findMpvRoot(outDir);
  if (!isSdkComplete(extractedRoot, asset)) {
    throw new Error(
      "[fetch-windows-libmpv] Extracted SDK at " +
        extractedRoot +
        " failed completion / sha256 verification",
    );
  }

  const manifestPath = path.join(extractedRoot, ".sdk-manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        target,
        archiveName: asset.name,
        archiveSha256: asset.sha256,
        dllSha256: asset.dllSha256,
        extractedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  publishLibmpvRoot(extractedRoot);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
