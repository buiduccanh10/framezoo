import fs from "node:fs";
import path from "node:path";

export const DEFAULT_DESKTOP_UPDATE_CHANNEL = "stable";
const DESKTOP_UPDATES_DIRNAME = "desktop-updates";
const DESKTOP_UPDATE_CHANNEL_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

export type DesktopDownloadOptionId =
  | "mac-arm64"
  | "mac-x64"
  | "mac-universal"
  | "win-x64"
  | "win-arm64";

export type DesktopReleasePlatform = "mac" | "win";
export type DesktopReleaseArch = "arm64" | "x64" | "universal";
export type DesktopReleaseFileKind =
  | "download"
  | "ota-feed"
  | "blockmap"
  | "artifact";

export function isSafeDesktopUpdateChannel(channel: string) {
  return DESKTOP_UPDATE_CHANNEL_RE.test(channel.trim());
}

export interface DesktopReleaseFile {
  id: string;
  kind: DesktopReleaseFileKind;
  platform: DesktopReleasePlatform;
  arch: DesktopReleaseArch;
  fileName: string;
  path: string;
  size: number;
  sha256?: string;
  label?: string;
  description?: string;
}

export interface DesktopReleaseManifest {
  version: string;
  channel: string;
  publishedAt: string;
  files: DesktopReleaseFile[];
}

function readEnv(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

export function getDesktopDownloadDir() {
  const defaultDownloadDir =
    process.env.NODE_ENV === "production"
      ? "/data/downloads"
      : path.resolve(process.cwd(), "../downloads");
  const rawDownloadDir = readEnv("APP_DOWNLOAD_DIR") || defaultDownloadDir;

  return path.isAbsolute(rawDownloadDir)
    ? rawDownloadDir
    : path.resolve(process.cwd(), rawDownloadDir);
}

export function getDesktopUpdateChannelDir(
  channel: string = DEFAULT_DESKTOP_UPDATE_CHANNEL,
) {
  const normalizedChannel = channel.trim();
  return path.join(
    getDesktopDownloadDir(),
    DESKTOP_UPDATES_DIRNAME,
    isSafeDesktopUpdateChannel(normalizedChannel)
      ? normalizedChannel
      : DEFAULT_DESKTOP_UPDATE_CHANNEL,
  );
}

export function getDesktopUpdateManifestPath(
  channel: string = DEFAULT_DESKTOP_UPDATE_CHANNEL,
) {
  return path.join(getDesktopUpdateChannelDir(channel), "manifest.json");
}

function isDesktopReleaseFile(
  value: unknown,
): value is DesktopReleaseFile {
  if (!value || typeof value !== "object") return false;

  const entry = value as Partial<DesktopReleaseFile>;
  return (
    typeof entry.id === "string" &&
    typeof entry.kind === "string" &&
    typeof entry.platform === "string" &&
    typeof entry.arch === "string" &&
    typeof entry.fileName === "string" &&
    typeof entry.path === "string" &&
    typeof entry.size === "number"
  );
}

function isDesktopReleaseManifest(
  value: unknown,
): value is DesktopReleaseManifest {
  if (!value || typeof value !== "object") return false;

  const manifest = value as Partial<DesktopReleaseManifest>;
  return (
    typeof manifest.version === "string" &&
    typeof manifest.channel === "string" &&
    typeof manifest.publishedAt === "string" &&
    Array.isArray(manifest.files) &&
    manifest.files.every(isDesktopReleaseFile)
  );
}

export function readDesktopReleaseManifest(
  channel: string = DEFAULT_DESKTOP_UPDATE_CHANNEL,
): DesktopReleaseManifest | null {
  if (!isSafeDesktopUpdateChannel(channel.trim())) return null;
  const manifestPath = getDesktopUpdateManifestPath(channel);
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!isDesktopReleaseManifest(manifest)) return null;
    return manifest;
  } catch {
    return null;
  }
}

export function getDesktopDownloadOptions(manifest: DesktopReleaseManifest) {
  return manifest.files.filter(
    (file): file is DesktopReleaseFile & {
      id: DesktopDownloadOptionId;
      kind: "download";
      label: string;
      description: string;
    } =>
      file.kind === "download" &&
      typeof file.label === "string" &&
      typeof file.description === "string",
  );
}

export function getDesktopDownloadOptionById(
  manifest: DesktopReleaseManifest,
  id: string,
) {
  return getDesktopDownloadOptions(manifest).find((file) => file.id === id);
}

export function resolveDesktopReleaseFilePath(
  channel: string,
  relativeFilePath: string,
) {
  if (!isSafeDesktopUpdateChannel(channel.trim())) return null;
  const channelDir = getDesktopUpdateChannelDir(channel);
  const resolvedPath = path.resolve(channelDir, relativeFilePath);
  const relativeFromRoot = path.relative(channelDir, resolvedPath);

  if (
    relativeFromRoot.startsWith("..") ||
    path.isAbsolute(relativeFromRoot)
  ) {
    return null;
  }

  return resolvedPath;
}

function resolveKnownFeedAlias(
  manifest: DesktopReleaseManifest,
  fileName: string,
) {
  const baseName = path.basename(fileName);
  if (baseName === "latest.yml") {
    return (
      manifest.files.find((file) => file.kind === "ota-feed" && file.id === "win-x64-feed") ??
      manifest.files.find(
        (file) => file.kind === "ota-feed" && file.platform === "win",
      ) ??
      null
    );
  }

  if (baseName === "latest-mac.yml") {
    return (
      manifest.files.find(
        (file) => file.kind === "ota-feed" && file.id === "mac-arm64-feed",
      ) ??
      manifest.files.find(
        (file) => file.kind === "ota-feed" && file.platform === "mac",
      ) ??
      null
    );
  }

  return null;
}

export function resolveDesktopUpdateRequest(
  channel: string,
  requestPath: string,
) {
  if (!isSafeDesktopUpdateChannel(channel.trim())) return null;
  const normalizedPath = requestPath.replace(/^\/+/, "");
  const directPath = resolveDesktopReleaseFilePath(channel, normalizedPath);

  if (directPath && fs.existsSync(directPath)) {
    return {
      filePath: directPath,
      fileName: path.basename(directPath),
    };
  }

  const manifest = readDesktopReleaseManifest(channel);
  if (!manifest) return null;

  const aliasTarget = resolveKnownFeedAlias(manifest, normalizedPath);
  if (!aliasTarget) return null;

  const aliasPath = resolveDesktopReleaseFilePath(channel, aliasTarget.path);
  if (!aliasPath || !fs.existsSync(aliasPath)) return null;

  return {
    filePath: aliasPath,
    fileName: path.basename(aliasPath),
  };
}
