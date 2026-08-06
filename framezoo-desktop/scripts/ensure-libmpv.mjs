import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktopRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const resourcesRoot = path.join(desktopRoot, "resources", "libmpv");
const supportedTargets = new Set([
  "darwin-arm64",
  "darwin-x64",
  "win32-arm64",
  "win32-x64",
  "darwin-universal",
]);

const targetIndex = process.argv.indexOf("--target");
const target =
  targetIndex >= 0
    ? process.argv[targetIndex + 1]
    : `${process.platform}-${process.arch}`;

if (!supportedTargets.has(target)) {
  throw new Error(`Unsupported libmpv target: ${target}`);
}

const targetDir = path.join(resourcesRoot, target);
const runtimeName = target.startsWith("win32-")
  ? "libmpv-2.dll"
  : "libmpv.2.dylib";
const runtimeSourceNames = target.startsWith("win32-")
  ? ["libmpv-2.dll", "mpv-2.dll", "libmpv.dll"]
  : [runtimeName];
const runtimePath = path.join(targetDir, runtimeName);
const configuredRoot = process.env.LIBMPV_ROOT;

if (target === "darwin-universal" && !fs.existsSync(runtimePath)) {
  const arm64Path = path.join(resourcesRoot, "darwin-arm64", runtimeName);
  const x64Path = path.join(resourcesRoot, "darwin-x64", runtimeName);
  if (fs.existsSync(arm64Path) && fs.existsSync(x64Path)) {
    fs.mkdirSync(targetDir, { recursive: true });
    execFileSync(process.env.LIPO ?? "lipo", [
      "-create",
      arm64Path,
      x64Path,
      "-output",
      runtimePath,
    ]);
  }
}

if (configuredRoot && target !== "darwin-universal") {
  const candidates = [
    ...runtimeSourceNames.flatMap((name) => [
      path.join(configuredRoot, "bin", name),
      path.join(configuredRoot, "lib", name),
      path.join(configuredRoot, name),
    ]),
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (source) {
    fs.mkdirSync(targetDir, { recursive: true });
    if (target.startsWith("darwin-")) {
      stageDarwinRuntime(source, targetDir);
    } else {
      stageWindowsRuntime(source, configuredRoot, targetDir, runtimeName);
    }
  }
}

if (!fs.existsSync(runtimePath)) {
  throw new Error(
    `Missing ${runtimeName} for ${target}. Set LIBMPV_ROOT or stage a pinned libmpv runtime in ${targetDir}.`,
  );
}

if (target.startsWith("darwin-")) {
}

console.log(`[libmpv] ready ${target}: ${runtimePath}`);

function commandOutput(command, args) {
  return execFileSync(command, args, { encoding: "utf8" });
}

function getDarwinDependencies(filePath) {
  const output = commandOutput("otool", ["-L", filePath]);
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" (")[0])
    .filter(Boolean);
}

function isSystemDarwinDependency(dependency) {
  return (
    dependency.startsWith("/System/Library/") ||
    dependency.startsWith("/usr/lib/")
  );
}

function findDarwinDependency(dependency, configuredRoot) {
  if (dependency.startsWith("/") && fs.existsSync(dependency)) {
    return dependency;
  }

  const fileName = path.basename(dependency);
  const searchRoots = [
    configuredRoot,
    path.resolve(configuredRoot, ".."),
    path.resolve(configuredRoot, "../.."),
  ];

  for (const root of searchRoots) {
    const directCandidates = [
      path.join(root, "lib", fileName),
      path.join(root, "libexec", fileName),
      path.join(root, fileName),
    ];
    const directMatch = directCandidates.find((candidate) =>
      fs.existsSync(candidate),
    );
    if (directMatch) return directMatch;

    const optDir = path.join(root, "opt");
    if (!fs.existsSync(optDir)) continue;
    for (const entry of fs.readdirSync(optDir)) {
      const candidate = path.join(optDir, entry, "lib", fileName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return null;
}

function stageDarwinRuntime(source, targetDir) {
  const configuredRoot = process.env.LIBMPV_ROOT;
  if (!configuredRoot) {
    throw new Error("LIBMPV_ROOT is required to stage a macOS libmpv runtime");
  }

  const runtimeOutput = path.join(targetDir, "libmpv.2.dylib");
  const dependencyDir = path.join(targetDir, "lib");
  fs.mkdirSync(dependencyDir, { recursive: true });

  const stagedFiles = new Map();
  const sourceFiles = new Map();

  function stageFile(sourcePath, outputPath) {
    const realSource = fs.realpathSync(sourcePath);
    if (stagedFiles.has(realSource)) return stagedFiles.get(realSource);

    if (fs.existsSync(outputPath)) fs.chmodSync(outputPath, 0o644);
    fs.copyFileSync(realSource, outputPath);
    fs.chmodSync(outputPath, 0o644);
    stagedFiles.set(realSource, outputPath);
    sourceFiles.set(outputPath, realSource);

    for (const dependency of getDarwinDependencies(realSource)) {
      if (dependency === realSource || isSystemDarwinDependency(dependency)) {
        continue;
      }

      const dependencySource = findDarwinDependency(dependency, configuredRoot);
      if (!dependencySource) {
        throw new Error(
          `Unable to stage macOS libmpv dependency ${dependency} required by ${realSource}`,
        );
      }

      const dependencyOutput = path.join(
        dependencyDir,
        path.basename(dependencySource),
      );
      stageFile(dependencySource, dependencyOutput);
    }

    return outputPath;
  }

  stageFile(source, runtimeOutput);

  for (const [outputPath, sourcePath] of sourceFiles) {
    const outputDirectory = path.dirname(outputPath);
    for (const dependency of getDarwinDependencies(sourcePath)) {
      if (dependency === sourcePath || isSystemDarwinDependency(dependency)) {
        continue;
      }

      const dependencySource = findDarwinDependency(dependency, configuredRoot);
      if (!dependencySource) continue;

      const dependencyOutput = path.join(
        dependencyDir,
        path.basename(dependencySource),
      );
      const relativePath = path.relative(outputDirectory, dependencyOutput);
      execFileSync("install_name_tool", [
        "-change",
        dependency,
        `@loader_path/${relativePath}`,
        outputPath,
      ]);
    }

    execFileSync("install_name_tool", [
      "-id",
      outputPath === runtimeOutput
        ? "@rpath/libmpv.2.dylib"
        : `@loader_path/${path.basename(outputPath)}`,
      outputPath,
    ]);
  }

  resignDarwinRuntime(targetDir);
}

function resignDarwinRuntime(targetDir) {
  const files = [];
  const runtimePath = path.join(targetDir, "libmpv.2.dylib");
  if (fs.existsSync(runtimePath)) files.push(runtimePath);

  const dependencyDir = path.join(targetDir, "lib");
  if (fs.existsSync(dependencyDir)) {
    for (const entry of fs.readdirSync(dependencyDir)) {
      const filePath = path.join(dependencyDir, entry);
      if (fs.statSync(filePath).isFile()) files.push(filePath);
    }
  }

  for (const filePath of files) {
    execFileSync("codesign", [
      "--force",
      "--sign",
      "-",
      "--timestamp=none",
      filePath,
    ]);
  }
}

function stageWindowsRuntime(source, configuredRoot, targetDir, runtimeName) {
  const runtimeOutput = path.join(targetDir, runtimeName);
  fs.mkdirSync(targetDir, { recursive: true });
  if (fs.existsSync(runtimeOutput)) fs.chmodSync(runtimeOutput, 0o644);
  fs.copyFileSync(source, runtimeOutput);
  fs.chmodSync(runtimeOutput, 0o644);

  const searchDirs = [
    path.dirname(source),
    path.join(configuredRoot, "bin"),
    path.join(configuredRoot, "lib"),
    configuredRoot,
  ];
  const seen = new Set([runtimeOutput]);
  for (const directory of searchDirs) {
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory)) {
      if (!entry.toLowerCase().endsWith(".dll")) continue;
      const sourcePath = path.join(directory, entry);
      const outputPath = path.join(targetDir, entry);
      if (seen.has(outputPath)) continue;
      if (fs.existsSync(outputPath)) fs.chmodSync(outputPath, 0o644);
      fs.copyFileSync(sourcePath, outputPath);
      fs.chmodSync(outputPath, 0o644);
      seen.add(outputPath);
    }
  }
}
