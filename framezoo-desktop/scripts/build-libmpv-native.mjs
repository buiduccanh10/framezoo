import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(root, "..");
const nativeRoot = path.join(desktopRoot, "native");
const stagedRoot = path.join(desktopRoot, "resources", "native");

const targets = new Set([
  "darwin-arm64",
  "darwin-x64",
  "win32-arm64",
  "win32-x64",
]);

const electronDistDir = path.join(
  desktopRoot,
  "node_modules",
  "electron",
  "dist",
);

function parseTarget() {
  const targetIndex = process.argv.indexOf("--target");
  if (targetIndex >= 0) return process.argv[targetIndex + 1];
  return `${process.platform}-${process.arch}`;
}

function getNodeGypCacheDir() {
  const candidates = [
    process.env.npm_config_cache
      ? path.join(process.env.npm_config_cache, "node-gyp")
      : null,
    process.env.NODE_GYP_CACHE ? path.join(process.env.NODE_GYP_CACHE) : null,
    path.join(os.homedir(), ".cache", "node-gyp"),
    path.join(os.homedir(), "AppData", "Local", "node-gyp", "Cache"),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function getElectronVersion() {
  const pkgPath = path.join(electronDistDir, "..", "package.json");
  try {
    const version = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
    if (typeof version === "string" && version.length > 0) return version;
  } catch {}
  return null;
}

function findElectronHeaders() {
  const version = getElectronVersion();
  if (!version) return null;

  const cacheDir = getNodeGypCacheDir();
  if (!cacheDir) return null;

  const candidateDir = path.join(cacheDir, version);
  if (!fs.existsSync(candidateDir)) return null;

  const includeDir = path.join(candidateDir, "include", "node");
  if (!fs.existsSync(path.join(includeDir, "node_api.h"))) return null;

  const libCandidates = [
    path.join(candidateDir, "win32-x64", "node.lib"),
    path.join(candidateDir, "win32-arm64", "node.lib"),
    path.join(candidateDir, "win-x64", "node.lib"),
    path.join(candidateDir, "x64", "node.lib"),
    path.join(candidateDir, "win32-x64", "electron.lib"),
  ];
  for (const lib of libCandidates) {
    if (fs.existsSync(lib)) return { includeDir, nodeLib: lib };
  }

  // Electron headers archives may not carry node.lib on every version;
  // fall back to the import library shipped inside Electron's dist.
  const distLib = path.join(electronDistDir, "node.lib");
  return fs.existsSync(distLib)
    ? { includeDir, nodeLib: distLib }
    : { includeDir, nodeLib: null };
}

function getNodeIncludeDir() {
  if (process.env.NODE_INCLUDE_DIR) return process.env.NODE_INCLUDE_DIR;

  const electronHeaders = findElectronHeaders();
  if (electronHeaders) return electronHeaders.includeDir;

  const candidates = [
    path.join(path.dirname(process.execPath), "..", "include", "node"),
    "/usr/local/include/node",
    "/opt/homebrew/include/node",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function getNodeLib(target) {
  if (!target.startsWith("win32-")) return null;
  if (process.env.NODE_LIB) return process.env.NODE_LIB;

  const electronHeaders = findElectronHeaders();
  if (electronHeaders?.nodeLib) return electronHeaders.nodeLib;

  const candidates = [
    path.join(electronDistDir, "node.lib"),
    path.join(path.dirname(process.execPath), "node.lib"),
    path.join(path.dirname(process.execPath), "..", "node.lib"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function getCmakeArgs(target, buildDir) {
  const args = [
    "-S",
    nativeRoot,
    "-B",
    buildDir,
    `-DNODE_INCLUDE_DIR=${getNodeIncludeDir()}`,
  ];

  if (target.startsWith("darwin-")) {
    args.push(
      `-DCMAKE_OSX_ARCHITECTURES=${target.endsWith("arm64") ? "arm64" : "x86_64"}`,
    );
  }

  if (target.startsWith("win32-")) {
    args.push("-A", target.endsWith("arm64") ? "ARM64" : "x64");
  }

  if (process.env.LIBMPV_ROOT) {
    args.push(`-DLIBMPV_ROOT=${process.env.LIBMPV_ROOT}`);
  }

  const nodeLib = getNodeLib(target);
  if (nodeLib) args.push(`-DNODE_LIB=${nodeLib}`);

  return args;
}

function verifyStagedAddon(target) {
  const stagedDir = path.join(stagedRoot, target);
  const addonPath = path.join(stagedDir, "libmpv.node");
  if (!fs.existsSync(addonPath)) {
    throw new Error(`Staged addon missing after build: ${addonPath}`);
  }

  // Warmup verification needs the libmpv runtime, staged by
  // resources:ensure which runs before or after this script depending on the
  // pipeline. When the runtime has not been staged yet, skip the load test
  // here; the explicit post-ensure verify steps in the release pipelines are
  // the authoritative gate.
  const runtimeDir = path.join(
    desktopRoot,
    "resources",
    "libmpv",
    target,
  );
  if (!fs.existsSync(runtimeDir)) {
    if (process.env.VERIFY_NATIVE) {
      throw new Error(
        `VERIFY_NATIVE is set but the libmpv runtime is not staged at ${runtimeDir}. Run resources:ensure first.`,
      );
    }
    console.warn(
      `[native] skipping ${target} load verification: runtime not staged at ${runtimeDir} (run resources:ensure before verifying)`,
    );
    return;
  }

  const verifyScript = path.join(root, "verify-libmpv-native.mjs");
  const verifyArgs = [
    verifyScript,
    "--addon",
    addonPath,
    "--runtime-dir",
    runtimeDir,
  ];

  execFileSync(process.execPath, verifyArgs, {
    cwd: desktopRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      // The running binary is either plain Node or Electron (dev).
      // Plain Node can load the addon because the delay hook redirects the
      // node core import to the process image, which exports N-API.
      FRAMEZOO_LIBMPV_ADDON: addonPath,
    },
  });

  console.log(`[native] verified ${target} -> ${addonPath}`);
}

const target = parseTarget();
if (!targets.has(target)) {
  throw new Error(`Unsupported native target: ${target}`);
}

const nodeIncludeDir = getNodeIncludeDir();
if (!nodeIncludeDir) {
  throw new Error("NODE_INCLUDE_DIR is required and could not be detected");
}

if (target.startsWith("win32-") && !getNodeLib(target)) {
  throw new Error(
    "NODE_LIB is required for Windows targets and could not be detected",
  );
}

const cmake = process.env.CMAKE ?? "cmake";
const buildDir = path.join(nativeRoot, "build", target);
fs.mkdirSync(buildDir, { recursive: true });

execFileSync(cmake, getCmakeArgs(target, buildDir), {
  cwd: desktopRoot,
  stdio: "inherit",
});
execFileSync(cmake, ["--build", buildDir, "--config", "Release"], {
  cwd: desktopRoot,
  stdio: "inherit",
});

const candidates = [
  path.join(buildDir, "libmpv.node"),
  path.join(buildDir, "Release", "libmpv.node"),
];
const addonPath = candidates.find((candidate) => fs.existsSync(candidate));
if (!addonPath) {
  throw new Error(`Native addon output not found in ${buildDir}`);
}

const stageDir = path.join(stagedRoot, target);
fs.mkdirSync(stageDir, { recursive: true });
fs.copyFileSync(addonPath, path.join(stageDir, "libmpv.node"));

if (target === `${process.platform}-${process.arch}` || process.env.VERIFY_NATIVE) {
  verifyStagedAddon(target);
}

console.log(
  `[native] staged ${target} -> ${path.join(stageDir, "libmpv.node")}`,
);
