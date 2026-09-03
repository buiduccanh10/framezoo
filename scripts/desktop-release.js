const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PRODUCT_NAME = "Framezoo";

const RELEASE_VARIANTS = {
  "mac-arm64": {
    id: "mac-arm64",
    platform: "mac",
    arch: "arm64",
    label: "macOS Apple Silicon",
    description: "Best for M-series Macs",
    feedFileName: "latest-mac.yml",
    downloadPattern: [
      /^Framezoo-(.+)-arm64-mac\.dmg$/,
      /^Framezoo-(.+)-arm64-mac\.zip$/,
    ],
    artifactPattern: /^Framezoo-(.+)-arm64-mac\.zip$/,
    blockmapPattern: /^Framezoo-(.+)-arm64-mac\.zip\.blockmap$/,
  },
  "mac-x64": {
    id: "mac-x64",
    platform: "mac",
    arch: "x64",
    label: "macOS Intel",
    description: "Best for Intel Macs",
    feedFileName: "latest-mac.yml",
    downloadPattern: [
      /^Framezoo-(.+)-x64-mac\.dmg$/,
      /^Framezoo-(.+)-x64-mac\.zip$/,
    ],
    artifactPattern: /^Framezoo-(.+)-x64-mac\.zip$/,
    blockmapPattern: /^Framezoo-(.+)-x64-mac\.zip\.blockmap$/,
  },
  "mac-universal": {
    id: "mac-universal",
    platform: "mac",
    arch: "universal",
    label: "macOS Universal",
    description: "Works on both Apple Silicon and Intel Macs",
    feedFileName: "latest-mac.yml",
    downloadPattern: [
      /^Framezoo-(.+)-universal-mac\.dmg$/,
      /^Framezoo-(.+)-universal-mac\.zip$/,
    ],
    artifactPattern: /^Framezoo-(.+)-universal-mac\.zip$/,
    blockmapPattern: /^Framezoo-(.+)-universal-mac\.zip\.blockmap$/,
  },
  "win-x64": {
    id: "win-x64",
    platform: "win",
    arch: "x64",
    label: "Windows x64",
    description: "Best for 64-bit Windows PCs",
    feedFileName: "latest.yml",
    downloadPattern: /^Framezoo-(.+)-x64\.exe$/,
    blockmapPattern: /^Framezoo-(.+)-x64\.exe\.blockmap$/,
  },
  "win-arm64": {
    id: "win-arm64",
    platform: "win",
    arch: "arm64",
    label: "Windows ARM64",
    description: "Best for Snapdragon\/ARM Windows PCs",
    feedFileName: "latest.yml",
    downloadPattern: /^Framezoo-(.+)-arm64\.exe$/,
    blockmapPattern: /^Framezoo-(.+)-arm64\.exe\.blockmap$/,
  },
};

const REQUIRED_RELEASE_VARIANTS = [
  "mac-arm64",
  "mac-x64",
  "win-x64",
  "win-arm64",
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function copyFile(sourcePath, destinationPath) {
  ensureDir(path.dirname(destinationPath));
  fs.copyFileSync(sourcePath, destinationPath);
}

function computeSha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function findMatchingFile(inputDir, pattern) {
  const entries = fs
    .readdirSync(inputDir)
    .sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }),
    );
  for (const entry of entries) {
    const match = entry.match(pattern);
    if (match) {
      return {
        fileName: entry,
        version: match[1],
      };
    }
  }

  return null;
}

function findMatchingFileFromPatterns(inputDir, patterns) {
  for (const pattern of patterns) {
    const match = findMatchingFile(inputDir, pattern);
    if (match) {
      return match;
    }
  }

  return null;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function collectVariantFiles(inputDir, variantId) {
  const descriptor = RELEASE_VARIANTS[variantId];
  assert(descriptor, `Unknown desktop release variant: ${variantId}`);
  assert(fs.existsSync(inputDir), `Missing artifact directory: ${inputDir}`);

  const downloadPatterns = Array.isArray(descriptor.downloadPattern)
    ? descriptor.downloadPattern
    : [descriptor.downloadPattern];
  const downloadFile = findMatchingFileFromPatterns(inputDir, downloadPatterns);
  assert(downloadFile, `Missing download artifact for ${variantId}`);

  const feedPath = path.join(inputDir, descriptor.feedFileName);
  assert(fs.existsSync(feedPath), `Missing feed file for ${variantId}`);

  const blockmapFile = descriptor.blockmapPattern
    ? findMatchingFile(inputDir, descriptor.blockmapPattern)
    : null;
  assert(blockmapFile, `Missing blockmap for ${variantId}`);

  const artifactFile = descriptor.artifactPattern
    ? findMatchingFile(inputDir, descriptor.artifactPattern)
    : null;

  if (descriptor.artifactPattern) {
    assert(artifactFile, `Missing update package for ${variantId}`);
  }

  const version =
    downloadFile.version ??
    artifactFile?.version ??
    blockmapFile?.version ??
    null;
  assert(version, `Could not determine version for ${variantId}`);

  for (const candidate of [artifactFile, blockmapFile]) {
    if (!candidate) continue;
    assert(
      candidate.version === version,
      `Mismatched artifact version in ${variantId}: expected ${version}, got ${candidate.version}`,
    );
  }

  return {
    descriptor,
    version,
    files: {
      feed: {
        fileName: descriptor.feedFileName,
        absolutePath: feedPath,
      },
      download: {
        fileName: downloadFile.fileName,
        absolutePath: path.join(inputDir, downloadFile.fileName),
      },
      artifact: artifactFile
        ? {
            fileName: artifactFile.fileName,
            absolutePath: path.join(inputDir, artifactFile.fileName),
          }
        : null,
      blockmap: blockmapFile
        ? {
            fileName: blockmapFile.fileName,
            absolutePath: path.join(inputDir, blockmapFile.fileName),
          }
        : null,
    },
  };
}

function buildManifestFileEntry(
  kind,
  descriptor,
  relativePath,
  absolutePath,
  extra,
) {
  return {
    id: extra.id,
    kind,
    platform: descriptor.platform,
    arch: descriptor.arch,
    fileName: path.basename(relativePath),
    path: relativePath,
    size: fs.statSync(absolutePath).size,
    sha256: computeSha256(absolutePath),
    ...(extra.label ? { label: extra.label } : {}),
    ...(extra.description ? { description: extra.description } : {}),
  };
}

function createDesktopReleaseBundle(options) {
  const {
    inputRoot,
    outputDir,
    channel = "stable",
    publishedAt = new Date().toISOString(),
    requiredVariants = REQUIRED_RELEASE_VARIANTS,
  } = options;

  removeDir(outputDir);
  ensureDir(outputDir);

  const manifest = {
    version: null,
    channel,
    publishedAt,
    files: [],
  };

  for (const variantId of requiredVariants) {
    const variantInputDir = path.join(inputRoot, variantId);
    const variant = collectVariantFiles(variantInputDir, variantId);

    if (!manifest.version) {
      manifest.version = variant.version;
    } else {
      assert(
        manifest.version === variant.version,
        `Version mismatch: expected ${manifest.version}, got ${variant.version} for ${variantId}`,
      );
    }

    const variantOutputDir = path.join(outputDir, variantId);
    ensureDir(variantOutputDir);

    const feedRelativePath = path.join(variantId, variant.files.feed.fileName);
    const feedOutputPath = path.join(outputDir, feedRelativePath);
    copyFile(variant.files.feed.absolutePath, feedOutputPath);
    manifest.files.push(
      buildManifestFileEntry(
        "ota-feed",
        variant.descriptor,
        feedRelativePath,
        feedOutputPath,
        {
          id: `${variantId}-feed`,
        },
      ),
    );

    const downloadRelativePath = path.join(
      variantId,
      variant.files.download.fileName,
    );
    const downloadOutputPath = path.join(outputDir, downloadRelativePath);
    copyFile(variant.files.download.absolutePath, downloadOutputPath);
    manifest.files.push(
      buildManifestFileEntry(
        "download",
        variant.descriptor,
        downloadRelativePath,
        downloadOutputPath,
        {
          id: variant.descriptor.id,
          label: variant.descriptor.label,
          description: variant.descriptor.description,
        },
      ),
    );

    if (
      variant.files.artifact &&
      variant.files.artifact.fileName !== variant.files.download.fileName
    ) {
      const artifactRelativePath = path.join(
        variantId,
        variant.files.artifact.fileName,
      );
      const artifactOutputPath = path.join(outputDir, artifactRelativePath);
      copyFile(variant.files.artifact.absolutePath, artifactOutputPath);
      manifest.files.push(
        buildManifestFileEntry(
          "artifact",
          variant.descriptor,
          artifactRelativePath,
          artifactOutputPath,
          {
            id: `${variantId}-artifact`,
          },
        ),
      );
    }

    if (variant.files.blockmap) {
      const blockmapRelativePath = path.join(
        variantId,
        variant.files.blockmap.fileName,
      );
      const blockmapOutputPath = path.join(outputDir, blockmapRelativePath);
      copyFile(variant.files.blockmap.absolutePath, blockmapOutputPath);
      manifest.files.push(
        buildManifestFileEntry(
          "blockmap",
          variant.descriptor,
          blockmapRelativePath,
          blockmapOutputPath,
          {
            id: `${variantId}-blockmap`,
          },
        ),
      );
    }
  }

  assert(manifest.version, "No desktop release version was generated");

  fs.writeFileSync(
    path.join(outputDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  return manifest;
}

function verifyDesktopReleaseBundle(bundleDir, options = {}) {
  const { requiredVariants = REQUIRED_RELEASE_VARIANTS } = options;
  const manifestPath = path.join(bundleDir, "manifest.json");
  assert(fs.existsSync(manifestPath), `Missing manifest.json in ${bundleDir}`);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert(
    manifest &&
      typeof manifest.version === "string" &&
      Array.isArray(manifest.files),
    "Invalid desktop release manifest",
  );

  for (const file of manifest.files) {
    assert(
      typeof file.path === "string",
      "Desktop release file path is missing",
    );
    const absolutePath = path.join(bundleDir, file.path);
    assert(fs.existsSync(absolutePath), `Missing release file: ${file.path}`);
  }

  for (const variantId of requiredVariants) {
    const hasDownload = manifest.files.some(
      (file) => file.kind === "download" && file.id === variantId,
    );
    const hasFeed = manifest.files.some(
      (file) => file.kind === "ota-feed" && file.id === `${variantId}-feed`,
    );
    assert(hasDownload, `Missing download entry for ${variantId}`);
    assert(hasFeed, `Missing OTA feed entry for ${variantId}`);
  }

  const platforms = new Set(
    manifest.files
      .filter((file) => file.kind === "download")
      .map((file) => file.platform),
  );
  assert(
    platforms.has("mac"),
    "Desktop release bundle is missing macOS artifacts",
  );
  assert(
    platforms.has("win"),
    "Desktop release bundle is missing Windows artifacts",
  );

  return manifest;
}

module.exports = {
  PRODUCT_NAME,
  RELEASE_VARIANTS,
  REQUIRED_RELEASE_VARIANTS,
  computeSha256,
  createDesktopReleaseBundle,
  ensureDir,
  removeDir,
  verifyDesktopReleaseBundle,
};
