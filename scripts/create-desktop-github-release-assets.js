#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { dump, load } = require("js-yaml");

const {
  computeSha256,
  createDesktopReleaseBundle,
  ensureDir,
  removeDir,
  verifyDesktopReleaseBundle,
} = require("./desktop-release");

const DEFAULT_RELEASE_OWNER = "buiduccanh10";
const DEFAULT_RELEASE_REPO = "framezoo-desktop-releases";

function getArgValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function copyFile(sourcePath, destinationPath) {
  ensureDir(path.dirname(destinationPath));
  fs.copyFileSync(sourcePath, destinationPath);
}

function readFeed(feedPath) {
  const value = load(fs.readFileSync(feedPath, "utf8"));
  assert(
    value && typeof value === "object",
    `Invalid update feed: ${feedPath}`,
  );
  assert(
    typeof value.version === "string",
    `Missing feed version: ${feedPath}`,
  );
  return value;
}

function getFeedFiles(feed) {
  if (Array.isArray(feed.files)) {
    return feed.files.filter(
      (file) =>
        file &&
        typeof file === "object" &&
        typeof file.url === "string" &&
        typeof file.sha512 === "string",
    );
  }

  if (typeof feed.path === "string" && typeof feed.sha512 === "string") {
    return [{ url: feed.path, sha512: feed.sha512 }];
  }

  return [];
}

function mergeUpdateFeeds(bundleDir, manifest, platform, outputPath) {
  const feedEntries = manifest.files.filter(
    (file) => file.kind === "ota-feed" && file.platform === platform,
  );
  assert(feedEntries.length > 0, `No ${platform} OTA feeds found`);

  const feeds = feedEntries.map((entry) =>
    readFeed(path.join(bundleDir, entry.path)),
  );
  const versions = new Set(feeds.map((feed) => feed.version));
  assert(versions.size === 1, `Mismatched ${platform} feed versions`);

  const mergedFiles = [];
  const seenUrls = new Set();
  for (const feed of feeds) {
    for (const file of getFeedFiles(feed)) {
      if (seenUrls.has(file.url)) continue;
      seenUrls.add(file.url);
      mergedFiles.push(file);
    }
  }

  assert(mergedFiles.length > 0, `No files found in ${platform} OTA feeds`);

  const firstPackage =
    mergedFiles.find((file) => file.url.toLowerCase().endsWith(".zip")) ??
    mergedFiles[0];
  const mergedFeed = {
    ...feeds[0],
    files: mergedFiles,
    path: firstPackage.url,
    sha512: firstPackage.sha512,
  };

  fs.writeFileSync(
    outputPath,
    dump(mergedFeed, {
      lineWidth: -1,
      noRefs: true,
    }),
  );
}

function createReleaseManifest(
  bundleManifest,
  bundleDir,
  releaseDir,
  owner,
  repo,
) {
  const releaseFiles = [];
  const seenAssetNames = new Set();
  for (const file of bundleManifest.files) {
    const assetName =
      file.kind === "ota-feed"
        ? file.platform === "mac"
          ? "latest-mac.yml"
          : "latest.yml"
        : file.fileName;
    const sourcePath = path.join(bundleDir, file.path);
    const releasePath = path.join(releaseDir, assetName);

    assert(fs.existsSync(sourcePath), `Missing bundle file: ${file.path}`);
    assert(fs.existsSync(releasePath), `Missing release asset: ${assetName}`);
    if (seenAssetNames.has(assetName)) continue;
    seenAssetNames.add(assetName);

    releaseFiles.push({
      ...file,
      fileName: assetName,
      path: assetName,
      size: fs.statSync(releasePath).size,
      sha256: computeSha256(releasePath),
    });
  }

  const downloadBaseUrl = `https://github.com/${owner}/${repo}/releases/latest/download`;
  const downloadFiles = bundleManifest.files.filter(
    (file) => file.kind === "download",
  );

  const downloadManifest = {
    version: bundleManifest.version,
    options: downloadFiles.map((file) => ({
      id: file.id,
      label: file.label,
      description: file.description,
      url: `${downloadBaseUrl}/${encodeURIComponent(file.fileName)}`,
    })),
  };

  return {
    releaseManifest: {
      ...bundleManifest,
      files: releaseFiles,
    },
    downloadManifest,
  };
}

function main() {
  const args = process.argv.slice(2);
  const inputRoot = getArgValue(args, "--input-root");
  const outputDir = getArgValue(args, "--output-dir");
  const channel = getArgValue(args, "--channel", "stable");
  const publishedAt = getArgValue(
    args,
    "--published-at",
    new Date().toISOString(),
  );
  const owner = getArgValue(args, "--owner", DEFAULT_RELEASE_OWNER);
  const repo = getArgValue(args, "--repo", DEFAULT_RELEASE_REPO);

  if (!inputRoot || !outputDir) {
    throw new Error(
      "Usage: node scripts/create-desktop-github-release-assets.js --input-root <dir> --output-dir <dir> [--channel stable] [--published-at ISO] [--owner owner] [--repo repo]",
    );
  }

  const resolvedInputRoot = path.resolve(inputRoot);
  const resolvedOutputDir = path.resolve(outputDir);
  const bundleDir = path.join(
    path.dirname(resolvedOutputDir),
    `.${path.basename(resolvedOutputDir)}-bundle-${process.pid}`,
  );

  removeDir(bundleDir);
  removeDir(resolvedOutputDir);

  try {
    const bundleManifest = createDesktopReleaseBundle({
      inputRoot: resolvedInputRoot,
      outputDir: bundleDir,
      channel,
      publishedAt,
    });
    verifyDesktopReleaseBundle(bundleDir);
    ensureDir(resolvedOutputDir);

    const copiedNames = new Set();
    for (const file of bundleManifest.files) {
      if (file.kind === "ota-feed") continue;

      const assetName = path.basename(file.fileName);
      assert(
        assetName === file.fileName,
        `Unsafe release asset name: ${file.fileName}`,
      );
      assert(
        !copiedNames.has(assetName),
        `Duplicate release asset: ${assetName}`,
      );
      copiedNames.add(assetName);

      copyFile(
        path.join(bundleDir, file.path),
        path.join(resolvedOutputDir, assetName),
      );
    }

    mergeUpdateFeeds(
      bundleDir,
      bundleManifest,
      "mac",
      path.join(resolvedOutputDir, "latest-mac.yml"),
    );
    mergeUpdateFeeds(
      bundleDir,
      bundleManifest,
      "win",
      path.join(resolvedOutputDir, "latest.yml"),
    );

    const { releaseManifest, downloadManifest } = createReleaseManifest(
      bundleManifest,
      bundleDir,
      resolvedOutputDir,
      owner,
      repo,
    );
    fs.writeFileSync(
      path.join(resolvedOutputDir, "manifest.json"),
      JSON.stringify(releaseManifest, null, 2),
    );
    fs.writeFileSync(
      path.join(resolvedOutputDir, "download-manifest.json"),
      JSON.stringify(downloadManifest, null, 2),
    );

    process.stdout.write(
      `${bundleManifest.version} ${resolvedOutputDir}${
        process.platform === "win32" ? "\r\n" : "\n"
      }`,
    );
  } finally {
    removeDir(bundleDir);
  }
}

main();
