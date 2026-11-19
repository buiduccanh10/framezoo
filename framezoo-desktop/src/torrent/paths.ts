import fs from "node:fs";
import path from "node:path";

export function resolveTorrentEnginePath() {
  const configuredPath = process.env.FRAMEZOO_TORRENT_NODE_ENGINE_PATH;
  if (configuredPath) {
    console.log("[torrent] using configured Node engine:", configuredPath);
    return configuredPath;
  }

  const candidates = [
    typeof process.resourcesPath === "string"
      ? path.join(process.resourcesPath, "torrent-engine", "torrent-node.cjs")
      : null,
    path.resolve(__dirname, "torrent-node.cjs"),
    path.resolve(process.cwd(), "dist", "torrent-node.cjs"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find((candidate) => fs.existsSync(candidate));

  console.log("[torrent] Node engine path resolution:", {
    found: found ?? null,
    searched: candidates,
  });

  return found;
}
