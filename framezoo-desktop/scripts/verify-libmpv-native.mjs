import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Loads a staged native libmpv addon the same way the packaged app does and
// runs the native warmup. On failure, prints diagnostics and exits non-zero.
//
// This script runs under either plain Node or Electron; the delay-load hook
// inside the addon resolves the node core import against whichever process
// image is running. Running it under Electron is the closest proxy for the
// packaged app.

function parseArgs(argv) {
  const args = { addon: null, runtimeDir: null, expectArch: null };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--addon") args.addon = argv[++index] ?? null;
    else if (value === "--runtime-dir") args.runtimeDir = argv[++index] ?? null;
    else if (value === "--expect-arch") args.expectArch = argv[++index] ?? null;
  }
  return args;
}

// Reads the PE machine type from a Windows binary so cross-compiled build
// jobs (e.g. an arm64 addon produced on an x64 runner) can assert the addon
// has the expected architecture without being able to load it.
const PE_MACHINE_NAMES = {
  0x014c: "x86",
  0x8664: "x64",
  0xaa64: "arm64",
};

function readPeArch(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 0x40) return null;
  const peOffset = buffer.readUInt32LE(0x3c);
  if (
    peOffset + 6 > buffer.length ||
    buffer.toString("latin1", peOffset, peOffset + 4) !== "PE\u0000\u0000"
  ) {
    return null;
  }
  const machine = buffer.readUInt16LE(peOffset + 4);
  return PE_MACHINE_NAMES[machine] ?? null;
}

function findRuntimePath(runtimeDir) {
  if (!fs.existsSync(runtimeDir)) return null;
  const names =
    process.platform === "win32"
      ? ["libmpv-2.dll", "mpv-2.dll", "libmpv.dll"]
      : ["libmpv.2.dylib", "libmpv.dylib"];

  const candidates = [runtimeDir];
  for (const entry of fs.readdirSync(runtimeDir, { withFileTypes: true })) {
    if (entry.isDirectory()) candidates.push(path.join(runtimeDir, entry.name));
  }

  for (const dir of candidates) {
    for (const name of names) {
      const fullPath = path.join(dir, name);
      if (fs.existsSync(fullPath)) return fullPath;
    }
  }
  return null;
}

async function main() {
  const { addon, runtimeDir, expectArch } = parseArgs(process.argv.slice(2));
  const addonPath = addon ? path.resolve(addon) : null;
  if (!addonPath || !fs.existsSync(addonPath)) {
    console.error(
      `[verify-libmpv] addon not found: ${addonPath ?? "(none)"}`,
    );
    process.exit(1);
  }

  // Cross-arch builds (e.g. arm64 addon on an x64 runner) cannot be loaded in
  // this process. Assert the addon's PE architecture and skip the load test.
  if (expectArch) {
    const addonArch = readPeArch(addonPath);
    if (process.platform === "win32" && !addonArch) {
      console.error(
        `[verify-libmpv] could not read PE architecture of ${addonPath}`,
      );
      process.exit(1);
    }
    if (addonArch && addonArch !== expectArch) {
      console.error(
        `[verify-libmpv] addon architecture is ${addonArch}, expected ${expectArch}`,
      );
      process.exit(1);
    }
    if (process.arch !== expectArch) {
      console.log(
        `[verify-libmpv] SKIP: ${expectArch} addon cannot load in a ${process.platform}-${process.arch} process; addon PE architecture verified as ${addonArch ?? "(unknown)"}`,
      );
      console.log("[verify-libmpv] OK");
      process.exit(0);
    }
  }

  const resolvedRuntimeDir = runtimeDir ? path.resolve(runtimeDir) : null;
  const runtimePath = findRuntimePath(resolvedRuntimeDir);
  if (runtimeDir && runtimePath) {
    process.env.FRAMEZOO_LIBMPV_PATH = runtimePath;
    console.log(`[verify-libmpv] runtime: ${runtimePath}`);
  } else if (runtimeDir) {
    console.error(
      `[verify-libmpv] runtime-dir was provided but no libmpv runtime was found in ${resolvedRuntimeDir}`,
    );
    process.exit(1);
  }

  console.log(`[verify-libmpv] addon: ${addonPath}`);
  console.log(`[verify-libmpv] host: ${process.platform}-${process.arch}`);
  console.log(
    `[verify-libmpv] runtime: node ${process.versions.node} ${
      process.versions.electron ? `electron ${process.versions.electron}` : ""
    }`,
  );

  let addonModule;
  try {
    addonModule = require(addonPath);
  } catch (error) {
    console.error(
      `[verify-libmpv] FAILED to load addon: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }

  if (typeof addonModule.warmup !== "function") {
    console.error("[verify-libmpv] addon does not export warmup()");
    process.exit(1);
  }

  try {
    const result = addonModule.warmup();
    if (result !== true) {
      console.error(`[verify-libmpv] warmup returned ${String(result)}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(
      `[verify-libmpv] FAILED warmup: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }

  console.log("[verify-libmpv] OK");
  console.log("[verify-libmpv] addon loads and warmup succeeds");
  process.exit(0);
}

main().catch((error) => {
  console.error("[verify-libmpv] unexpected failure:", error);
  process.exit(1);
});