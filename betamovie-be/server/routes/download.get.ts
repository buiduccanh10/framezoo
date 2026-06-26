import fs from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { getQuery, sendRedirect, sendStream, setHeader } from 'h3';

import { version as desktopVersion } from '../../../betamovie-desktop/package.json';

type DownloadOptionId =
  | "mac-arm64"
  | "mac-x64"
  | "mac-universal"
  | "win-x64"
  | "win-arm64";

type DownloadOptionConfig = {
  id: DownloadOptionId;
  label: string;
  description: string;
  fileName: string;
  urlEnv: string;
};

const DOWNLOAD_OPTIONS: DownloadOptionConfig[] = [
  {
    id: "mac-arm64",
    label: "macOS Apple Silicon",
    description: "Best for M-series Macs",
    fileName: `AlphaFlix-${desktopVersion}-arm64.dmg`,
    urlEnv: "APP_DOWNLOAD_MAC_ARM64_URL",
  },
  {
    id: "mac-x64",
    label: "macOS Intel",
    description: "Best for Intel Macs",
    fileName: `AlphaFlix-${desktopVersion}-x64.dmg`,
    urlEnv: "APP_DOWNLOAD_MAC_X64_URL",
  },
  {
    id: "mac-universal",
    label: "macOS Universal",
    description: "Works on both Apple Silicon and Intel Macs",
    fileName: `AlphaFlix-${desktopVersion}-universal.dmg`,
    urlEnv: "APP_DOWNLOAD_MAC_UNIVERSAL_URL",
  },
  {
    id: "win-x64",
    label: "Windows x64",
    description: "Best for 64-bit Windows PCs",
    fileName: `AlphaFlix-${desktopVersion}-x64.zip`,
    urlEnv: "APP_DOWNLOAD_WIN_X64_URL",
  },
  {
    id: "win-arm64",
    label: "Windows ARM64",
    description: "Best for Snapdragon/ARM Windows PCs",
    fileName: `AlphaFlix-${desktopVersion}-arm64.zip`,
    urlEnv: "APP_DOWNLOAD_WIN_ARM64_URL",
  },
];

type DownloadOptionResponse = {
  id: DownloadOptionId;
  label: string;
  description: string;
  url: string;
};

function readEnv(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

function getAvailableFileName(option: DownloadOptionConfig, downloadDir: string | null): string | null {
  if (!downloadDir) return null;

  let candidates: string[] = [];
  if (option.id.startsWith('mac-')) {
    const arch = option.id.substring(4);
    candidates = [
      `AlphaFlix-${desktopVersion}-${arch}-mac.dmg`,
      `AlphaFlix-${desktopVersion}-${arch}-mac.zip`,
      `AlphaFlix-${desktopVersion}-${arch}.dmg`
    ];
  } else if (option.id.startsWith('win-')) {
    const arch = option.id.substring(4);
    candidates = [
      `AlphaFlix-${desktopVersion}-${arch}.zip`,
      `AlphaFlix-${desktopVersion}-${arch}.exe`
    ];
  }

  for (const candidate of candidates) {
    const filePath = path.join(downloadDir, candidate);
    if (fs.existsSync(filePath)) {
      return candidate;
    }
  }

  return null;
}

function getFileName(option: DownloadOptionConfig, downloadDir: string | null): string {
  const existingName = getAvailableFileName(option, downloadDir);
  if (existingName) return existingName;
  return option.fileName;
}

function resolveTargetUrl(option: DownloadOptionConfig, downloadDir: string | null): string | null {
  const directUrl = readEnv(option.urlEnv);
  if (directUrl) return directUrl;

  const baseUrl = readEnv('APP_DOWNLOAD_BASE_URL');
  if (!baseUrl) return null;

  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const fileName = getFileName(option, downloadDir);
  return new URL(fileName, normalizedBaseUrl).toString();
}

function isOptionAvailable(option: DownloadOptionConfig, downloadDir: string | null): boolean {
  if (downloadDir) {
    const existingName = getAvailableFileName(option, downloadDir);
    if (existingName) {
      return true;
    }
  }
  return resolveTargetUrl(option, downloadDir) !== null;
}

function resolveManifest(downloadDir: string | null): DownloadOptionResponse[] {
  return DOWNLOAD_OPTIONS.flatMap(option => {
    const isAvailable = isOptionAvailable(option, downloadDir);
    if (!isAvailable) return [];

    return [
      {
        id: option.id,
        label: option.label,
        description: option.description,
        url: `/download?option=${option.id}`,
      },
    ];
  });
}

export default defineEventHandler(async event => {
  const { option } = getQuery(event);
  const normalizedOption =
    typeof option === 'string'
      ? option.trim()
      : Array.isArray(option)
        ? option[0]?.trim() || ''
        : '';

  const defaultDownloadDir =
    process.env.NODE_ENV === 'production'
      ? '/data/downloads'
      : path.resolve(process.cwd(), '../downloads');
  const rawDownloadDir = readEnv('APP_DOWNLOAD_DIR') || defaultDownloadDir;
  const downloadDir = path.isAbsolute(rawDownloadDir)
    ? rawDownloadDir
    : path.resolve(process.cwd(), rawDownloadDir);

  if (normalizedOption) {
    const config = DOWNLOAD_OPTIONS.find(entry => entry.id === normalizedOption);

    if (!config) {
      throw createError({
        statusCode: 404,
        message: 'Download option not found',
      });
    }

    // 1. Try serving from local volume
    if (downloadDir) {
      const fileName = getFileName(config, downloadDir);
      const filePath = path.join(downloadDir, fileName);
      if (fs.existsSync(filePath)) {
        setHeader(event, 'Content-Disposition', `attachment; filename="${fileName}"`);
        setHeader(event, 'Content-Type', 'application/octet-stream');
        setHeader(event, 'Content-Length', fs.statSync(filePath).size);
        return sendStream(event, createReadStream(filePath));
      }
    }

    // 2. Fallback to redirect URLs if not found in volume
    const targetUrl = resolveTargetUrl(config, downloadDir);
    if (!targetUrl) {
      throw createError({
        statusCode: 404,
        message: 'Download option is not configured',
      });
    }

    return sendRedirect(event, targetUrl, 302);
  }

  setHeader(event, 'Cache-Control', 'public, max-age=300');

  return {
    version: desktopVersion,
    options: resolveManifest(downloadDir),
  };
});
