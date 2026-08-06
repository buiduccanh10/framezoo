import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "src/main.ts",
    preload: "src/preload.ts",
  },
  clean: true,
  external: ["electron"],
  format: ["cjs"],
  outDir: "dist",
  platform: "node",
  sourcemap: true,
  splitting: false,
  target: "node20",
  outExtension() {
    return {
      js: ".cjs",
    };
  },
  define: {
    "process.env.VITE_BACKEND_URL": JSON.stringify(process.env.VITE_BACKEND_URL || ""),
    "process.env.VITE_ENABLE_DEVTOOLS_PROTECTION": JSON.stringify(
      process.env.VITE_ENABLE_DEVTOOLS_PROTECTION || "",
    ),
  },
});
