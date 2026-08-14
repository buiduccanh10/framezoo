import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const engineRoot = path.join(desktopRoot, "torrent-engine");
const venvPython = path.join(
  engineRoot,
  ".venv",
  ...(process.platform === "win32"
    ? ["Scripts", "python.exe"]
    : ["bin", "python"]),
);
const target = process.argv[2] ?? `${process.platform}-${process.arch}`;
const hostTarget = `${process.platform}-${process.arch}`;
const supportedTargets = new Set([
  "darwin-arm64",
  "darwin-x64",
  "win32-arm64",
  "win32-x64",
]);
const binaryName =
  process.platform === "win32" ? "torrent-engine.exe" : "torrent-engine";
const outputDir = path.join(engineRoot, "bin", target);
const buildDir = path.join(engineRoot, ".build", target);

function fail(message) {
  throw new Error(`[torrent-build] ${message}`);
}

function main() {
  if (!supportedTargets.has(target)) {
    fail(`Unsupported target: ${target}`);
  }
  if (target !== hostTarget) {
    fail(
      `Target ${target} must be built on a matching ${target} runner; current host is ${hostTarget}. Native binaries are required for each platform.`,
    );
  }
  if (!fs.existsSync(venvPython)) {
    fail(
      "Torrent Python environment is missing. Run `pnpm run torrent:setup` first.",
    );
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(buildDir, { recursive: true });

  const result = spawnSync(
    venvPython,
    [
      "-m",
      "PyInstaller",
      "--noconfirm",
      "--clean",
      "--onefile",
      "--name",
      "torrent-engine",
      "--distpath",
      outputDir,
      "--workpath",
      buildDir,
      "--specpath",
      buildDir,
      "--collect-all",
      "libtorrent",
      "--hidden-import",
      "libtorrent",
      path.join(engineRoot, "libtorrent_sidecar.py"),
    ],
    {
      cwd: desktopRoot,
      env: process.env,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`PyInstaller exited with code ${result.status ?? "unknown"}.`);
  }

  const outputPath = path.join(outputDir, binaryName);
  if (!fs.existsSync(outputPath)) {
    fail(`Expected sidecar binary was not created: ${outputPath}`);
  }
  if (process.platform !== "win32") {
    fs.chmodSync(outputPath, 0o755);
  }
  console.log(`[torrent-build] Created ${outputPath} for target ${target}`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
