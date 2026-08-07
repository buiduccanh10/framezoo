import type {
  AppDownloadManifest,
  AppDownloadOption,
  AppDownloadOptionId,
} from "@/backend/download";

export type DetectedPlatform = "macos" | "windows" | "other";
export type DetectedArchitecture = "arm64" | "x64" | "unknown";

export interface PlatformDetection {
  platform: DetectedPlatform;
  architecture: DetectedArchitecture;
  recommendedId: AppDownloadOptionId | null;
}

interface PlatformNavigator {
  userAgent?: string;
  userAgentData?: {
    architecture?: string;
    platform?: string;
  };
}

export function detectPlatform(
  navigatorLike: PlatformNavigator | undefined = typeof navigator !==
  "undefined"
    ? navigator
    : undefined,
): Omit<PlatformDetection, "recommendedId"> {
  const userAgent = navigatorLike?.userAgent ?? "";
  const userAgentData = navigatorLike?.userAgentData;
  const platformValue = `${userAgent} ${userAgentData?.platform ?? ""}`;
  const architectureValue = `${userAgentData?.architecture ?? ""} ${userAgent}`;

  const platform = /Windows/i.test(platformValue)
    ? "windows"
    : /Macintosh|Mac OS X|macOS/i.test(platformValue)
      ? "macos"
      : "other";

  const architecture = /\barm64|aarch64|\barm\b/i.test(architectureValue)
    ? "arm64"
    : /\bx86_64\b|x86-64|amd64|\bx64\b|\bx86\b|Win64|WOW64/i.test(
          architectureValue,
        )
      ? "x64"
      : "unknown";

  return { platform, architecture };
}

export function getRecommendedOptionId(
  options: AppDownloadOption[],
  detection = detectPlatform(),
) {
  const optionIds = new Set(options.map((option) => option.id));

  if (detection.platform === "macos") {
    if (detection.architecture === "arm64" && optionIds.has("mac-arm64")) {
      return "mac-arm64";
    }
    if (detection.architecture === "x64" && optionIds.has("mac-x64")) {
      return "mac-x64";
    }
  }

  if (detection.platform === "windows") {
    if (detection.architecture === "arm64" && optionIds.has("win-arm64")) {
      return "win-arm64";
    }
    if (detection.architecture === "x64" && optionIds.has("win-x64")) {
      return "win-x64";
    }
  }

  return null;
}

export function detectPlatformForManifest(
  manifest: AppDownloadManifest,
  navigatorLike?: PlatformNavigator,
): PlatformDetection {
  const detected = detectPlatform(navigatorLike);
  return {
    ...detected,
    recommendedId: getRecommendedOptionId(manifest.options, detected),
  };
}
