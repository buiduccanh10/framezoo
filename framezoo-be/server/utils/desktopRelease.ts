export const DEFAULT_DESKTOP_UPDATE_CHANNEL = 'stable';
export const DESKTOP_RELEASE_OWNER = 'buiduccanh10';
export const DESKTOP_RELEASE_REPO = 'framezoo-desktop-releases';

const DESKTOP_UPDATE_CHANNEL_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const DESKTOP_RELEASE_ASSET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const DESKTOP_DOWNLOAD_OPTION_IDS = new Set([
  'mac-arm64',
  'mac-x64',
  'mac-universal',
  'win-x64',
  'win-arm64',
]);

export type DesktopDownloadOptionId =
  | 'mac-arm64'
  | 'mac-x64'
  | 'mac-universal'
  | 'win-x64'
  | 'win-arm64';

export interface DesktopDownloadManifestOption {
  id: DesktopDownloadOptionId;
  label: string;
  description: string;
  url: string;
}

export interface DesktopDownloadManifest {
  version: string | null;
  options: DesktopDownloadManifestOption[];
}

export function isSafeDesktopUpdateChannel(channel: string) {
  return DESKTOP_UPDATE_CHANNEL_RE.test(channel.trim());
}

export function getDesktopGitHubReleaseAssetUrl(fileName: string) {
  if (!DESKTOP_RELEASE_ASSET_NAME_RE.test(fileName)) return null;

  return `https://github.com/${DESKTOP_RELEASE_OWNER}/${DESKTOP_RELEASE_REPO}/releases/latest/download/${encodeURIComponent(fileName)}`;
}

export function isDesktopGitHubReleaseAssetUrl(value: string) {
  try {
    const url = new URL(value);
    const pathPrefix = `/${DESKTOP_RELEASE_OWNER}/${DESKTOP_RELEASE_REPO}/releases/latest/download/`;
    const encodedFileName = url.pathname.startsWith(pathPrefix)
      ? url.pathname.slice(pathPrefix.length)
      : '';
    const fileName = decodeURIComponent(encodedFileName);

    return (
      url.origin === 'https://github.com' &&
      encodedFileName.length > 0 &&
      DESKTOP_RELEASE_ASSET_NAME_RE.test(fileName) &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

export function getDesktopGitHubDownloadManifestUrl() {
  return getDesktopGitHubReleaseAssetUrl('download-manifest.json');
}

function isDesktopDownloadManifest(value: unknown): value is DesktopDownloadManifest {
  if (!value || typeof value !== 'object') return false;

  const manifest = value as Partial<DesktopDownloadManifest>;
  if (manifest.version !== null && typeof manifest.version !== 'string') {
    return false;
  }
  if (!Array.isArray(manifest.options)) return false;

  const seenIds = new Set<string>();
  return manifest.options.every(option => {
    if (!option || typeof option !== 'object') return false;
    const entry = option as Partial<DesktopDownloadManifestOption>;
    if (
      typeof entry.id !== 'string' ||
      !DESKTOP_DOWNLOAD_OPTION_IDS.has(entry.id) ||
      seenIds.has(entry.id) ||
      typeof entry.label !== 'string' ||
      typeof entry.description !== 'string' ||
      typeof entry.url !== 'string' ||
      entry.label.trim().length === 0 ||
      entry.description.trim().length === 0 ||
      !isDesktopGitHubReleaseAssetUrl(entry.url)
    ) {
      return false;
    }

    seenIds.add(entry.id);
    return true;
  });
}

export async function fetchDesktopDownloadManifest(): Promise<DesktopDownloadManifest | null> {
  const endpoint = getDesktopGitHubDownloadManifestUrl();
  if (!endpoint) return null;

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    return isDesktopDownloadManifest(payload) ? payload : null;
  } catch {
    return null;
  }
}
