import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "vite";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const outputDir = await mkdtemp(path.join(os.tmpdir(), "framezoo-fe-ssr-"));

try {
  await build({
    root: projectRoot,
    configFile: path.join(projectRoot, "vite.config.mts"),
    ssr: {
      noExternal: true,
    },
    build: {
      ssr: path.join(projectRoot, "src/ssr.tsx"),
      outDir: outputDir,
      emptyOutDir: true,
      rollupOptions: {
        output: {
          entryFileNames: "server.mjs",
        },
      },
    },
  });

  const renderer = await import(
    pathToFileURL(path.join(outputDir, "server.mjs")).href
  );
  const indexPath = path.join(projectRoot, "dist/index.html");
  const indexHtml = await readFile(indexPath, "utf8");
  const renderedApp = renderer.renderApp("/");
  const rootPlaceholder = '<div id="root"></div>';

  if (!indexHtml.includes(rootPlaceholder)) {
    throw new Error("Prerender target does not contain the root placeholder.");
  }

  await writeFile(
    indexPath,
    indexHtml.replace(rootPlaceholder, `<div id="root">${renderedApp}</div>`),
  );
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
