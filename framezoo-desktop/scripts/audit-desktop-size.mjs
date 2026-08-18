import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const targetPath = path.resolve(
  process.argv[2] ?? path.join(desktopRoot, "release"),
);

if (!fs.existsSync(targetPath)) {
  console.error(`[desktop-size] path does not exist: ${targetPath}`);
  process.exitCode = 1;
} else {
  const files = [];

  function walk(currentPath, relativePath = "", collectFiles = true) {
    const stats = fs.lstatSync(currentPath);
    if (stats.isSymbolicLink()) return 0;
    if (stats.isFile()) {
      if (collectFiles) {
        files.push({
          path: relativePath || path.basename(currentPath),
          size: stats.size,
        });
      }
      return stats.size;
    }
    if (!stats.isDirectory()) return 0;

    let total = 0;
    for (const entry of fs.readdirSync(currentPath)) {
      total += walk(
        path.join(currentPath, entry),
        path.join(relativePath, entry),
        collectFiles,
      );
    }
    return total;
  }

  const totalSize = walk(targetPath);

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  }

  function directorySize(relativePath) {
    const absolutePath = path.join(targetPath, relativePath);
    return fs.existsSync(absolutePath)
      ? walk(absolutePath, relativePath, false)
      : 0;
  }

  const topLevel = fs
    .readdirSync(targetPath)
    .map((entry) => ({
      path: entry,
      size: directorySize(entry),
    }))
    .sort((a, b) => b.size - a.size);

  console.log(`[desktop-size] target: ${targetPath}`);
  console.log(`[desktop-size] total:  ${formatBytes(totalSize)}`);
  console.log("\nTop-level:");
  for (const entry of topLevel.slice(0, 20)) {
    console.log(`${formatBytes(entry.size).padStart(10)}  ${entry.path}`);
  }

  console.log("\nLargest files:");
  for (const entry of files.sort((a, b) => b.size - a.size).slice(0, 30)) {
    console.log(`${formatBytes(entry.size).padStart(10)}  ${entry.path}`);
  }
}
