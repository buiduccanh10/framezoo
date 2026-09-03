#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const {
  RELEASE_VARIANTS,
  REQUIRED_RELEASE_VARIANTS,
  ensureDir,
  removeDir,
} = require("./desktop-release");

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

function listInputFiles(inputDir) {
  assert(fs.existsSync(inputDir), `Missing staging directory: ${inputDir}`);
  return fs
    .readdirSync(inputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

function findOne(inputDir, fileNames, pattern, label) {
  const matches = fileNames.filter((fileName) => pattern.test(fileName));
  pattern.lastIndex = 0;
  assert(
    matches.length === 1,
    `Expected exactly one staged ${label}; found ${matches.length}: ${matches.join(", ") || "<none>"}`,
  );

  const sourcePath = path.join(inputDir, matches[0]);
  assert(fs.statSync(sourcePath).size > 0, `Staged asset is empty: ${matches[0]}`);
  return matches[0];
}

function findOneByName(inputDir, fileNames, fileName, label) {
  assert(
    fileNames.includes(fileName),
    `Missing staged ${label}: ${fileName}`,
  );

  const sourcePath = path.join(inputDir, fileName);
  assert(fs.statSync(sourcePath).size > 0, `Staged asset is empty: ${fileName}`);
  return fileName;
}

function prepareVariant(inputDir, outputDir, fileNames, variantId) {
  const descriptor = RELEASE_VARIANTS[variantId];
  assert(descriptor, `Unknown desktop release variant: ${variantId}`);

  const variantOutputDir = path.join(outputDir, variantId);
  ensureDir(variantOutputDir);

  const feedPrefix = descriptor.platform === "mac" ? "latest-mac" : "latest-win";
  const stagingFeedName = `${feedPrefix}-${descriptor.arch}.yml`;
  const feedName = findOneByName(
    inputDir,
    fileNames,
    stagingFeedName,
    `${variantId} feed`,
  );
  copyFile(
    path.join(inputDir, feedName),
    path.join(variantOutputDir, descriptor.feedFileName),
  );

  const patterns = [
    ...(Array.isArray(descriptor.downloadPattern)
      ? descriptor.downloadPattern
      : [descriptor.downloadPattern]),
    ...(descriptor.artifactPattern ? [descriptor.artifactPattern] : []),
    ...(descriptor.blockmapPattern ? [descriptor.blockmapPattern] : []),
  ];
  const copiedNames = new Set([feedName]);

  for (const pattern of patterns) {
    const fileName = findOne(
      inputDir,
      fileNames,
      pattern,
      `${variantId} artifact`,
    );
    if (copiedNames.has(fileName)) continue;
    copiedNames.add(fileName);
    copyFile(path.join(inputDir, fileName), path.join(variantOutputDir, fileName));
  }
}

function main() {
  const args = process.argv.slice(2);
  const inputDir = getArgValue(args, "--input-dir");
  const outputDir = getArgValue(args, "--output-dir");

  if (!inputDir || !outputDir) {
    throw new Error(
      "Usage: node scripts/prepare-desktop-github-release-input.js --input-dir <dir> --output-dir <dir>",
    );
  }

  const resolvedInputDir = path.resolve(inputDir);
  const resolvedOutputDir = path.resolve(outputDir);
  const fileNames = listInputFiles(resolvedInputDir);

  removeDir(resolvedOutputDir);
  ensureDir(resolvedOutputDir);
  for (const variantId of REQUIRED_RELEASE_VARIANTS) {
    prepareVariant(resolvedInputDir, resolvedOutputDir, fileNames, variantId);
  }

  process.stdout.write(
    `${REQUIRED_RELEASE_VARIANTS.length} desktop variants prepared in ${resolvedOutputDir}${
      process.platform === "win32" ? "\r\n" : "\n"
    }`,
  );
}

main();
