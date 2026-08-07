import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { readFileSync } from "node:fs";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const workspaceRoot = path.resolve(__dirname, "..");
  const env = loadEnv(mode, workspaceRoot);
  const desktopPackage = JSON.parse(
    readFileSync(
      path.resolve(workspaceRoot, "framezoo-desktop/package.json"),
      "utf8",
    ),
  ) as { version?: string };
  const desktopVersion = desktopPackage.version;

  if (!desktopVersion) {
    throw new Error(
      "framezoo-desktop/package.json must define a version for the landing build.",
    );
  }

  return {
    envDir: workspaceRoot,
    base: env.VITE_BASE_URL || "/",
    define: {
      __FRAMEZOO_DESKTOP_VERSION__: JSON.stringify(desktopVersion),
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    css: {
      postcss: {
        plugins: [],
      },
    },
    test: {
      environment: "jsdom",
      server: {
        deps: {
          inline: [
            "@csstools/css-calc",
            "@asamuzakjp/css-color",
            "@csstools/css-color-parser",
            "@csstools/css-parser-algorithms",
            "@csstools/css-tokenizer",
          ],
        },
      },
    },
  };
});
