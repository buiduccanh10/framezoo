#!/usr/bin/env node

const path = require("node:path");

const { verifyDesktopReleaseBundle } = require("./desktop-release");

function main() {
  const bundleDir = process.argv[2];
  if (!bundleDir) {
    throw new Error(
      "Usage: node scripts/verify-desktop-release-bundle.js <bundle-dir>",
    );
  }

  const manifest = verifyDesktopReleaseBundle(path.resolve(bundleDir));
  process.stdout.write(
    `${manifest.version}${process.platform === "win32" ? "\r\n" : "\n"}`,
  );
}

main();
