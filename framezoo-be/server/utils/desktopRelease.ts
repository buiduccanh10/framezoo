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
  'mac-arm64' | 'mac-x64' | 'mac-universal' | 'win-x64' | 'win-arm64';

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

export function isDesktopAppDownloadAsset(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    (lower.endsWith('.dmg') || lower.endsWith('.exe') || lower.endsWith('.zip')) &&
    !lower.endsWith('.blockmap')
  );
}

interface GitHubReleaseAsset {
  name?: string;
  download_count?: number;
}

interface GitHubReleaseItem {
  tag_name?: string;
  assets?: GitHubReleaseAsset[];
}

let cachedTotalDownloads: { value: number; timestamp: number } | null = null;
const DOWNLOAD_STATS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function fetchDesktopTotalDownloads(): Promise<number | null> {
  const now = Date.now();
  if (cachedTotalDownloads && now - cachedTotalDownloads.timestamp < DOWNLOAD_STATS_CACHE_TTL_MS) {
    return cachedTotalDownloads.value;
  }

  const endpoint = `https://api.github.com/repos/${DESKTOP_RELEASE_OWNER}/${DESKTOP_RELEASE_REPO}/releases?per_page=100`;

  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Framezoo-Backend',
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(endpoint, {
      headers,
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      return cachedTotalDownloads ? cachedTotalDownloads.value : null;
    }

    const releases: unknown = await response.json();
    if (!Array.isArray(releases)) {
      return cachedTotalDownloads ? cachedTotalDownloads.value : null;
    }

    let total = 0;
    for (const release of releases as GitHubReleaseItem[]) {
      if (Array.isArray(release.assets)) {
        for (const asset of release.assets) {
          if (
            typeof asset.name === 'string' &&
            isDesktopAppDownloadAsset(asset.name) &&
            typeof asset.download_count === 'number' &&
            asset.download_count > 0
          ) {
            total += asset.download_count;
          }
        }
      }
    }

    cachedTotalDownloads = { value: total, timestamp: now };
    return total;
  } catch {
    return cachedTotalDownloads ? cachedTotalDownloads.value : null;
  }
}
