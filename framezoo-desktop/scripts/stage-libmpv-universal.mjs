import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktopRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const nativeRoot = path.join(desktopRoot, "resources", "native");
const libmpvRoot = path.join(desktopRoot, "resources", "libmpv");
const outputNative = path.join(nativeRoot, "darwin-universal");
const outputLibmpv = path.join(libmpvRoot, "darwin-universal");
const lipo = process.env.LIPO ?? "lipo";

function combine(relativePath, outputRoot) {
  const arm64 = path.join(outputRoot, "..", "darwin-arm64", relativePath);
  const x64 = path.join(outputRoot, "..", "darwin-x64", relativePath);
  const output = path.join(outputRoot, relativePath);

  if (!fs.existsSync(arm64) || !fs.existsSync(x64)) {
    throw new Error(
      `Missing macOS slices for ${relativePath}. Build arm64 and x64 first.`,
    );
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  execFileSync(lipo, ["-create", arm64, x64, "-output", output], {
    stdio: "inherit",
  });
  execFileSync(
    "codesign",
    ["--force", "--sign", "-", "--timestamp=none", output],
    { stdio: "inherit" },
  );
  console.log(`[universal] staged ${output}`);
}

combine("libmpv.node", outputNative);
combine("libmpv.2.dylib", outputLibmpv);

const arm64DependencyDir = path.join(libmpvRoot, "darwin-arm64", "lib");
const x64DependencyDir = path.join(libmpvRoot, "darwin-x64", "lib");
const universalDependencyDir = path.join(outputLibmpv, "lib");
const dependencyNames = new Set([
  ...(fs.existsSync(arm64DependencyDir)
    ? fs.readdirSync(arm64DependencyDir)
    : []),
  ...(fs.existsSync(x64DependencyDir) ? fs.readdirSync(x64DependencyDir) : []),
]);

for (const dependencyName of dependencyNames) {
  combine(`lib/${dependencyName}`, outputLibmpv);
}
