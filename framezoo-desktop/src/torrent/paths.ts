import fs from "node:fs";
import path from "node:path";

function getRunnerName() {
  return process.platform === "win32" ? "run.cmd" : "run.sh";
}

function getBinaryName() {
  return process.platform === "win32" ? "torrent-engine.exe" : "torrent-engine";
}

function isRunnerReady(runnerPath: string) {
  const pythonName =
    process.platform === "win32"
      ? path.join(".venv", "Scripts", "python.exe")
      : path.join(".venv", "bin", "python");
  return fs.existsSync(path.join(path.dirname(runnerPath), pythonName));
}

export function resolveTorrentEnginePath() {
  const configuredPath = process.env.FRAMEZOO_TORRENT_ENGINE_PATH;
  if (configuredPath) {
    console.log(
      "[torrent] using FRAMEZOO_TORRENT_ENGINE_PATH:",
      configuredPath,
    );
    return configuredPath;
  }

  const runnerName = getRunnerName();
  const binaryName = getBinaryName();
  const target = `${process.platform}-${process.arch}`;
  const developmentRunner = path.resolve(
    __dirname,
    "..",
    "torrent-engine",
    runnerName,
  );
  const candidates: (string | null)[] = [
    typeof process.resourcesPath === "string"
      ? path.join(
          process.resourcesPath,
          "torrent-engine",
          "bin",
          target,
          binaryName,
        )
      : null,
    isRunnerReady(developmentRunner) ? developmentRunner : null,
    path.resolve(__dirname, "..", "torrent-engine", "bin", target, binaryName),
    path.resolve(process.cwd(), "torrent-engine", runnerName),
  ];

  const filtered = candidates.filter((candidate): candidate is string =>
    Boolean(candidate),
  );
  const found = filtered.find((candidate) => fs.existsSync(candidate));

  console.log("[torrent] engine path resolution:", {
    target,
    found: found ?? null,
    searched: filtered,
  });

  return found;
}
