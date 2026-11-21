const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const desktopDir = path.join(rootDir, "framezoo-desktop");
const downloadsDir = path.join(rootDir, "downloads");

// Load environment variables from root .env file if it exists to pass VITE_BACKEND_URL to builds
const envPath = path.join(rootDir, ".env");
if (fs.existsSync(envPath)) {
  console.log("Loading environment variables from root .env file...");
  const envContent = fs.readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const firstEqual = trimmed.indexOf("=");
    if (firstEqual === -1) continue;
    const key = trimmed.slice(0, firstEqual).trim();
    const val = trimmed
      .slice(firstEqual + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

// 1. Create downloads folder in root if it doesn't exist
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// Remove stale release artifacts so the downloads dir only contains the latest build set.
for (const entry of fs.readdirSync(downloadsDir)) {
  if (entry.startsWith("Framezoo-") || entry === "README.txt") {
    fs.rmSync(path.join(downloadsDir, entry), { recursive: true, force: true });
  }
}

// 2. Build and package desktop applications for the current host OS via framezoo-desktop scripts.
const PLATFORM_TARGETS = {
  darwin: [
    {
      name: "macOS Apple Silicon (arm64)",
      script: "package:release:mac:arm64",
      artifacts: (version) => [`Framezoo-${version}-arm64-mac.dmg`],
    },
    {
      name: "macOS Intel (x64)",
      script: "package:release:mac:x64",
      artifacts: (version) => [`Framezoo-${version}-x64-mac.dmg`],
    },
    {
      name: "macOS Universal",
      script: "package:release:mac:universal",
      artifacts: (version) => [`Framezoo-${version}-universal-mac.dmg`],
    },
  ],
  win32: [
    {
      name: "Windows x64",
      script: "package:release:win:x64",
      artifacts: (version) => [`Framezoo-${version}-x64.exe`],
    },
    {
      name: "Windows ARM64",
      script: "package:release:win:arm64",
      artifacts: (version) => [`Framezoo-${version}-arm64.exe`],
    },
  ],
};

const targets = PLATFORM_TARGETS[process.platform];
if (!targets) {
  console.error(
    `Unsupported host platform "${process.platform}". Framezoo desktop native builds support darwin and win32 only.`,
  );
  process.exit(1);
}

console.log(`Packaging desktop applications for ${process.platform}...`);
for (const target of targets) {
  console.log(`\n--- Building target: ${target.name} ---`);
  try {
    execSync(`pnpm run ${target.script}`, { cwd: desktopDir, stdio: "inherit" });
  } catch (error) {
    console.error(`Failed to build target ${target.name}:`, error.message);
  }
}

// 3. Find version from package.json (match electron-builder's normalized version, e.g. 2.4.1-a)
const packageJson = JSON.parse(
  fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"),
);
const rawVersion = String(packageJson.version || "").trim();
const version = rawVersion.replace(
  /^(\d+\.\d+\.\d+)([A-Za-z][0-9A-Za-z]*)$/,
  "$1-$2",
);

// 4. Copy built artifacts to the downloads folder
const releaseDir = path.join(desktopDir, "release");
console.log(
  `\nCopying packaged builds (v${version}) from ${releaseDir} to ${downloadsDir}...`,
);

const filesToCopy = targets.flatMap((target) => target.artifacts(version));

let copiedCount = 0;
for (const file of filesToCopy) {
  const src = path.join(releaseDir, file);
  const dest = path.join(downloadsDir, file);
  if (fs.existsSync(src)) {
    console.log(`Copying ${file}...`);
    fs.copyFileSync(src, dest);
    copiedCount++;
  } else {
    console.warn(
      `Warning: Built file ${file} was not found in release directory.`,
    );
  }
}

// Also copy the README.txt guide
const readmeSrc = path.join(desktopDir, "README.txt");
const readmeDest = path.join(downloadsDir, "README.txt");
if (fs.existsSync(readmeSrc)) {
  console.log("Copying README.txt...");
  fs.copyFileSync(readmeSrc, readmeDest);
}

console.log(
  `Successfully built and copied ${copiedCount} files to the downloads folder.`,
);

if (copiedCount === 0) {
  console.error(
    "Error: No files were successfully built and copied! Failing build.",
  );
  process.exit(1);
}

console.log("Desktop builds remain in the local downloads directory.");
