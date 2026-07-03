#!/usr/bin/env node

const path = require("node:path");

const {
  createDesktopReleaseBundle,
  ensureDir,
} = require("./desktop-release");

function getArgValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function main() {
  const args = process.argv.slice(2);
  const inputRoot = getArgValue(args, "--input-root");
  const outputDir = getArgValue(args, "--output-dir");
  const channel = getArgValue(args, "--channel", "stable");
  const publishedAt = getArgValue(args, "--published-at", new Date().toISOString());

  if (!inputRoot || !outputDir) {
    throw new Error(
      "Usage: node scripts/create-desktop-release-bundle.js --input-root <dir> --output-dir <dir> [--channel stable] [--published-at ISO]",
    );
  }

  ensureDir(path.resolve(outputDir));
  const manifest = createDesktopReleaseBundle({
    inputRoot: path.resolve(inputRoot),
    outputDir: path.resolve(outputDir),
    channel,
    publishedAt,
  });

  process.stdout.write(
    `${manifest.version} ${path.resolve(outputDir)}${process.platform === "win32" ? "\r\n" : "\n"}`,
  );
}

main();
