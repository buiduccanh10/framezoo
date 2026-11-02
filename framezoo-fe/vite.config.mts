import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const workspaceRoot = path.resolve(__dirname, "..");
  const env = loadEnv(mode, workspaceRoot);

  return {
    envDir: workspaceRoot,
    base: env.VITE_BASE_URL || "/",
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
    server: {
      port: 5173,
      proxy: {
        "/addon": {
          target: env.VITE_BACKEND_URL || "http://127.0.0.1:3000",
          changeOrigin: true,
        },
        "/api": {
          target: env.VITE_BACKEND_URL || "http://127.0.0.1:3000",
          changeOrigin: true,
        },
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
