import fs from "node:fs";
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

function parseTarget() {
  const targetIndex = process.argv.indexOf("--target");
  if (targetIndex >= 0) return process.argv[targetIndex + 1];
  return `${process.platform}-${process.arch}`;
}

function getNodeIncludeDir() {
  if (process.env.NODE_INCLUDE_DIR) return process.env.NODE_INCLUDE_DIR;

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

  const candidates = [
    path.join(path.dirname(process.execPath), "node.lib"),
    path.join(path.dirname(process.execPath), "..", "node.lib"),
    path.join(desktopRoot, "node_modules", "electron", "dist", "node.lib"),
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

const target = parseTarget();
if (!targets.has(target)) {
  throw new Error(`Unsupported native target: ${target}`);
}

const nodeIncludeDir = getNodeIncludeDir();
if (!nodeIncludeDir) {
  throw new Error("NODE_INCLUDE_DIR is required and could not be detected");
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

console.log(
  `[native] staged ${target} -> ${path.join(stageDir, "libmpv.node")}`,
);
