import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const rendererRoot = path.join(desktopRoot, "renderer");

const webOnlyAssets = [
  "_headers",
  "_redirects",
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
  "apple-touch-icon.png",
  "browserconfig.xml",
  "embed-preview.png",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "mstile-150x150.jpeg",
  "robots.txt",
  "safari-pinned-tab.svg",
  "splash_screens",
];

let removedCount = 0;
let removedBytes = 0;

for (const relativePath of webOnlyAssets) {
  const absolutePath = path.join(rendererRoot, relativePath);
  if (!fs.existsSync(absolutePath)) continue;

  const entries = [];
  const stack = [absolutePath];
  while (stack.length > 0) {
    const currentPath = stack.pop();
    const stats = fs.lstatSync(currentPath);
    if (stats.isDirectory()) {
      for (const entry of fs.readdirSync(currentPath)) {
        stack.push(path.join(currentPath, entry));
      }
    } else if (stats.isFile()) {
      entries.push(stats.size);
    }
  }

  removedBytes += entries.reduce((total, size) => total + size, 0);
  removedCount += entries.length;
  fs.rmSync(absolutePath, { recursive: true, force: true });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

console.log(
  `[desktop-renderer] removed ${removedCount} web-only files (${formatBytes(removedBytes)})`,
);
