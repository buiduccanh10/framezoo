import { getQuery, sendRedirect, setHeader } from "h3";

import { version as desktopVersion } from "../../../betamovie-desktop/package.json";

type DownloadOptionId = "mac-arm64" | "mac-x64" | "mac-universal";

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
    fileName: `BetaMovie-${desktopVersion}-arm64.dmg`,
    urlEnv: "APP_DOWNLOAD_MAC_ARM64_URL",
  },
  {
    id: "mac-x64",
    label: "macOS Intel",
    description: "Best for Intel Macs",
    fileName: `BetaMovie-${desktopVersion}-x64.dmg`,
    urlEnv: "APP_DOWNLOAD_MAC_X64_URL",
  },
  {
    id: "mac-universal",
    label: "macOS Universal",
    description: "Works on both Apple Silicon and Intel Macs",
    fileName: `BetaMovie-${desktopVersion}-universal.dmg`,
    urlEnv: "APP_DOWNLOAD_MAC_UNIVERSAL_URL",
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

function resolveTargetUrl(option: DownloadOptionConfig): string | null {
  const directUrl = readEnv(option.urlEnv);
  if (directUrl) return directUrl;

  const baseUrl = readEnv("APP_DOWNLOAD_BASE_URL");
  if (!baseUrl) return null;

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(option.fileName, normalizedBaseUrl).toString();
}

function resolveManifest(): DownloadOptionResponse[] {
  return DOWNLOAD_OPTIONS.flatMap((option) => {
    const targetUrl = resolveTargetUrl(option);
    if (!targetUrl) return [];

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

export default defineEventHandler(async (event) => {
  const { option } = getQuery(event);
  const normalizedOption =
    typeof option === "string"
      ? option.trim()
      : Array.isArray(option)
        ? option[0]?.trim() || ""
        : "";

  if (normalizedOption) {
    const config = DOWNLOAD_OPTIONS.find((entry) => entry.id === normalizedOption);

    if (!config) {
      throw createError({
        statusCode: 404,
        message: "Download option not found",
      });
    }

    const targetUrl = resolveTargetUrl(config);
    if (!targetUrl) {
      throw createError({
        statusCode: 404,
        message: "Download option is not configured",
      });
    }

    return sendRedirect(event, targetUrl, 302);
  }

  setHeader(event, "Cache-Control", "public, max-age=300");

  return {
    version: desktopVersion,
    options: resolveManifest(),
  };
});
