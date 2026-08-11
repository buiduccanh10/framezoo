import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import loadVersion from "vite-plugin-package-version";
import { VitePWA } from "vite-plugin-pwa";
import checker from "vite-plugin-checker";
import { readFileSync } from "fs";
import path from "path";
import { handlebars } from "./plugins/handlebars";
import { PluginOption, loadEnv } from "vite";
import { visualizer } from "rollup-plugin-visualizer";

import tailwind from "tailwindcss";
import rtl from "postcss-rtlcss";

const captioningPackages = [
  "dompurify",
  "htmlparser2",
  "subsrt-ts",
  "parse5",
  "entities",
  "fuse",
];

function emitVersionManifest(version: string, buildId: string): PluginOption {
  return {
    name: "emit-version-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify(
          {
            version,
            buildId,
          },
          null,
          2,
        ),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const workspaceRoot = path.resolve(__dirname, "../..");
  const env = loadEnv(mode, workspaceRoot);
  const packageJson = JSON.parse(
    readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"),
  ) as { version?: string };
  const appVersion = packageJson.version ?? "0.0.0";
  const appBuildId =
    env.VITE_APP_BUILD_ID ||
    process.env.GITHUB_SHA ||
    process.env.SOURCE_VERSION ||
    new Date().toISOString();
  return {
    root: __dirname,
    envDir: workspaceRoot,
    base: env.VITE_BASE_URL || "/",
    define: {
      __APP_BUILD_ID__: JSON.stringify(appBuildId),
    },
    plugins: [
      handlebars({
        vars: {
          opensearchEnabled: env.VITE_OPENSEARCH_ENABLED === "true",
          routeDomain:
            env.VITE_APP_DOMAIN +
            (env.VITE_NORMAL_ROUTER !== "true" ? "/#" : ""),
          domain: env.VITE_APP_DOMAIN,
          env,
        },
      }),
      react(),
      VitePWA({
        disable: env.VITE_PWA_ENABLED !== "true",
        registerType: "prompt",
        workbox: {
          maximumFileSizeToCacheInBytes: 4000000, // 4mb
          globIgnores: ["!assets/**/*", "version.json"],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
        },
        includeAssets: [
          "favicon.ico",
          "apple-touch-icon.png",
          "safari-pinned-tab.svg",
        ],
        manifest: {
          name: "Framezoo",
          short_name: "Framezoo",
          description:
            "Watch your favorite shows and movies for free with no ads ever! ",
          theme_color: "#000000",
          background_color: "#000000",
          display: "standalone",
          start_url: "/",
          icons: [
            {
              src: "android-chrome-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "android-chrome-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "android-chrome-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "android-chrome-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
      }),
      emitVersionManifest(appVersion, appBuildId),
      loadVersion(),
      ...(mode !== "production"
        ? [
            checker({
              overlay: {
                position: "tr",
              },
              typescript: {
                root: __dirname,
                tsconfigPath: "tsconfig.json",
              },
            }),
          ]
        : []),
      ...(mode !== "production" ? [visualizer() as PluginOption] : []),
    ],

    build: {
      outDir: path.resolve(__dirname, "..", "renderer"),
      emptyOutDir: true,
      sourcemap: mode !== "production",
      rolldownOptions: {
        output: {
          manualChunks(id: string) {
            if (
              id.includes("@sozialhelden+ietf-language-tags") ||
              id.includes("country-language")
            ) {
              return "language-db";
            }
            if (id.includes("node-forge") || id.includes("crypto-js")) {
              return "auth";
            }
            if (id.includes("locales") && !id.includes("en.json")) {
              return "locales";
            }
            if (id.includes("react-dom")) {
              return "react-dom";
            }
            if (id.includes("Icon.tsx")) {
              return "Icons";
            }
            const isCaptioningPackage = captioningPackages.some((packageName) =>
              id.includes(packageName),
            );
            if (isCaptioningPackage) {
              return "caption-parsing";
            }
          },
        },
      },
    },
    css: {
      postcss: {
        plugins: [
          tailwind({
            config: path.resolve(__dirname, "tailwind.config.ts"),
          }),
          rtl(),
        ],
      },
    },

    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@themes": path.resolve(__dirname, "./themes"),
        "@sozialhelden/ietf-language-tags": path.resolve(
          __dirname,
          "../node_modules/@sozialhelden/ietf-language-tags/dist/cjs",
        ),
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
