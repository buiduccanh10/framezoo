import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const engineRoot = path.join(desktopRoot, "torrent-engine");
const requirementsPath = path.join(engineRoot, "requirements.txt");
const venvRoot = path.join(engineRoot, ".venv");
const isWindows = process.platform === "win32";
const venvPython = path.join(
  venvRoot,
  ...(isWindows ? ["Scripts", "python.exe"] : ["bin", "python"]),
);

function run(command, args) {
  console.log(`[torrent-setup] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with code ${result.status ?? "unknown"}`,
    );
  }
}

function canImportLibtorrent() {
  if (!fs.existsSync(venvPython)) return false;
  const result = spawnSync(
    venvPython,
    ["-c", "import libtorrent, PyInstaller"],
    {
      cwd: desktopRoot,
      stdio: "ignore",
    },
  );
  return result.status === 0;
}

function findSystemPython() {
  const candidates = isWindows
    ? [
        { command: "py", prefix: ["-3"] },
        { command: "python", prefix: [] },
      ]
    : [
        { command: process.env.PYTHON_BIN || "python3", prefix: [] },
        { command: "python", prefix: [] },
      ];

  for (const candidate of candidates) {
    const result = spawnSync(
      candidate.command,
      [...candidate.prefix, "--version"],
      { stdio: "ignore" },
    );
    if (result.status === 0) return candidate;
  }

  throw new Error(
    "Python 3 not found. Install Python 3 or set PYTHON_BIN before starting the desktop app.",
  );
}

function main() {
  if (canImportLibtorrent()) {
    console.log("[torrent-setup] Existing libtorrent environment is ready.");
    return;
  }

  const python = findSystemPython();
  if (fs.existsSync(venvRoot)) {
    fs.rmSync(venvRoot, { recursive: true, force: true });
  }

  run(python.command, [...python.prefix, "-m", "venv", venvRoot]);
  run(venvPython, ["-m", "pip", "install", "-r", requirementsPath]);

  if (!canImportLibtorrent()) {
    throw new Error(
      "libtorrent installation completed but import still fails.",
    );
  }

  console.log("[torrent-setup] Torrent engine is ready.");
}

try {
  main();
} catch (error) {
  console.error("[torrent-setup] Failed:", error);
  process.exitCode = 1;
}
