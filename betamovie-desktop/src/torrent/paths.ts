import fs from "node:fs";
import path from "node:path";

function getRunnerName() {
  return process.platform === "win32" ? "run.cmd" : "run.sh";
}

function getBinaryName() {
  return process.platform === "win32" ? "torrent-engine.exe" : "torrent-engine";
}

export function resolveTorrentEnginePath() {
  const configuredPath = process.env.BETAMOVIE_TORRENT_ENGINE_PATH;
  if (configuredPath) {
    return configuredPath;
  }

  const runnerName = getRunnerName();
  const binaryName = getBinaryName();
  const target = `${process.platform}-${process.arch}`;
  const binaryTargets =
    target === "win32-arm64" ? [target, "win32-x64"] : [target];
  const candidates = binaryTargets.flatMap((binaryTarget) => [
    typeof process.resourcesPath === "string"
      ? path.join(
          process.resourcesPath,
          "torrent-engine",
          "bin",
          binaryTarget,
          binaryName,
        )
      : null,
    path.resolve(
      __dirname,
      "..",
      "torrent-engine",
      "bin",
      binaryTarget,
      binaryName,
    ),
  ]);
  candidates.push(
    path.resolve(__dirname, "..", "torrent-engine", runnerName),
    path.resolve(process.cwd(), "torrent-engine", runnerName),
  );

  return candidates
    .filter((candidate): candidate is string => Boolean(candidate))
    .find((candidate) => fs.existsSync(candidate));
}
