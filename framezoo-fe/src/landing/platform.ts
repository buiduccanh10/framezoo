import { useEffect, useState } from "react";

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

export interface PlatformNavigatorLike {
  userAgent?: string;
  userAgentData?: {
    architecture?: string;
    bitness?: string;
    platform?: string;
    brands?: Array<{ brand: string; version: string }>;
    mobile?: boolean;
    getHighEntropyValues?: (hints: string[]) => Promise<{
      architecture?: string;
      bitness?: string;
      platform?: string;
      [key: string]: unknown;
    }>;
  };
  platform?: string;
  maxTouchPoints?: number;
  gpu?: {
    requestAdapter?: () => Promise<{
      info?: {
        architecture?: string;
        vendor?: string;
        device?: string;
        description?: string;
      };
    } | null>;
  };
}

export interface DeepDetectionContext {
  navigator?: PlatformNavigatorLike;
  webGlRenderer?: string;
  fpuArchitecture?: DetectedArchitecture;
}

/**
 * Detects CPU architecture family (ARM vs x86) directly via the IEEE 754 floating-point standard.
 *
 * An indeterminate operation (Infinity - Infinity) produces a quiet NaN.
 * Under IEEE 754, the processor hardware determines the NaN payload and sign bits:
 * - x86/x64 processors (Intel/AMD) set the sign bit, producing a high byte of 255 (0xFF).
 * - ARM processors (Apple Silicon, ARM64, Snapdragon) leave the sign bit 0, producing a high byte of 127 (0x7F).
 *
 * This works across all modern JS engines (V8, JavaScriptCore, SpiderMonkey)
 * and reliably classifies devices when browsers freeze the User-Agent string.
 */
export function detectFpuArchitecture(): DetectedArchitecture {
  try {
    if (
      typeof Float32Array === "undefined" ||
      typeof Uint8Array === "undefined" ||
      typeof Uint32Array === "undefined"
    ) {
      return "unknown";
    }

    const f32 = new Float32Array(1);
    const bytes = new Uint8Array(f32.buffer);
    f32[0] = Infinity;
    f32[0] = f32[0] - f32[0];

    const isLittleEndian =
      new Uint8Array(new Uint32Array([0x12345678]).buffer)[0] === 0x78;
    const highByte = isLittleEndian ? bytes[3] : bytes[0];

    if (highByte === 127) return "arm64";
    if (highByte === 255) return "x64";
  } catch {
    // Restricted or headless environment
  }
  return "unknown";
}

/**
 * Retrieves the unmasked GPU renderer string via WebGL debug info when available.
 */
export function getWebGlRenderer(documentLike?: Document): string {
  try {
    const doc =
      documentLike ?? (typeof document !== "undefined" ? document : undefined);
    if (!doc || typeof doc.createElement !== "function") return "";

    const canvas = doc.createElement("canvas");
    const gl =
      canvas.getContext("webgl") ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return "";

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (!debugInfo) return "";

    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    return typeof renderer === "string" ? renderer : "";
  } catch {
    return "";
  }
}

function isDetectionContext(value: unknown): value is DeepDetectionContext {
  if (!value || typeof value !== "object") return false;
  return (
    "navigator" in value ||
    "webGlRenderer" in value ||
    "fpuArchitecture" in value
  );
}

function resolveContext(
  navigatorLikeOrContext?: PlatformNavigatorLike | DeepDetectionContext,
): {
  nav?: PlatformNavigatorLike;
  webGlRenderer?: string;
  fpuArch?: DetectedArchitecture;
} {
  if (!navigatorLikeOrContext) {
    const isBrowser = typeof window !== "undefined";
    return {
      nav: typeof navigator !== "undefined" ? navigator : undefined,
      webGlRenderer: isBrowser ? getWebGlRenderer() : undefined,
      fpuArch: isBrowser ? detectFpuArchitecture() : undefined,
    };
  }

  if (isDetectionContext(navigatorLikeOrContext)) {
    return {
      nav: navigatorLikeOrContext.navigator,
      webGlRenderer: navigatorLikeOrContext.webGlRenderer,
      fpuArch: navigatorLikeOrContext.fpuArchitecture,
    };
  }

  return {
    nav: navigatorLikeOrContext,
    webGlRenderer: undefined,
    fpuArch: undefined,
  };
}

export function detectPlatform(
  navigatorLikeOrContext?: PlatformNavigatorLike | DeepDetectionContext,
): Omit<PlatformDetection, "recommendedId"> {
  const {
    nav,
    webGlRenderer = "",
    fpuArch = "unknown",
  } = resolveContext(navigatorLikeOrContext);

  const userAgent = nav?.userAgent ?? "";
  const userAgentData = nav?.userAgentData;
  const navPlatform = nav?.platform ?? "";
  const maxTouchPoints = nav?.maxTouchPoints ?? 0;

  const combinedPlatform = `${userAgent} ${userAgentData?.platform ?? ""} ${navPlatform}`;

  // 1. Operating System Detection
  let platform: DetectedPlatform = "other";

  if (/iPhone|iPod/i.test(userAgent)) {
    platform = "other";
  } else if (/iPad/i.test(userAgent)) {
    platform = "other";
  } else if (/Windows/i.test(combinedPlatform)) {
    platform = "windows";
  } else if (/Macintosh|Mac OS X|macOS|MacIntel/i.test(combinedPlatform)) {
    // iPadOS 13+ requests desktop sites with "Macintosh; Intel Mac OS X 10_15_7"
    // Desktop Macs do not have touchscreens (maxTouchPoints === 0).
    // iPads have touchscreens (maxTouchPoints > 1).
    if (maxTouchPoints > 1) {
      platform = "other";
    } else {
      platform = "macos";
    }
  } else if (/Android|Linux/i.test(combinedPlatform)) {
    platform = "other";
  }

  // 2. Deep Chip (Architecture) Detection
  let architecture: DetectedArchitecture = "unknown";

  const rawArch = `${userAgentData?.architecture ?? ""} ${userAgent}`;
  const hasArmRegex = /\barm64\b|\baarch64\b|\barm\b/i.test(rawArch);
  const hasX64Regex =
    /\bx86_64\b|x86-64|amd64|\bx64\b|\bx86\b|Win64|WOW64/i.test(rawArch);

  const isAppleSiliconGpu = /\bApple\s*M\d|\bApple\s*Silicon\b/i.test(
    webGlRenderer,
  );
  const isIntelGpu = /\b(Intel|Iris|HD Graphics|UHD Graphics)\b/i.test(
    webGlRenderer,
  );
  const isAmdGpu = /\b(AMD|Radeon)\b/i.test(webGlRenderer);
  const isSnapdragonGpu = /\b(Snapdragon|Qualcomm|Adreno)\b/i.test(
    webGlRenderer,
  );

  if (platform === "macos") {
    // GPU hardware check: Apple Silicon M-series GPU (even if running x86 Chrome under Rosetta 2)
    if (isAppleSiliconGpu) {
      architecture = "arm64";
    } else if (hasArmRegex || userAgentData?.architecture === "arm") {
      architecture = "arm64";
    } else if (isIntelGpu || isAmdGpu) {
      architecture = "x64";
    } else if (fpuArch === "arm64") {
      architecture = "arm64";
    } else if (fpuArch === "x64") {
      architecture = "x64";
    } else if (hasX64Regex || userAgentData?.architecture === "x86") {
      architecture = "x64";
    } else if (webGlRenderer.includes("Apple GPU")) {
      // In Safari, WebGL masks to "Apple GPU" on modern Apple devices:
      architecture = "arm64";
    }
  } else if (platform === "windows") {
    if (
      hasArmRegex ||
      userAgentData?.architecture === "arm" ||
      isSnapdragonGpu ||
      fpuArch === "arm64"
    ) {
      architecture = "arm64";
    } else if (
      hasX64Regex ||
      userAgentData?.architecture === "x86" ||
      isIntelGpu ||
      isAmdGpu ||
      fpuArch === "x64"
    ) {
      architecture = "x64";
    }
  }

  return { platform, architecture };
}

export function getRecommendedOptionId(
  options: AppDownloadOption[],
  detection = detectPlatform(),
): AppDownloadOptionId | null {
  const optionIds = new Set(options.map((option) => option.id));

  if (detection.platform === "macos") {
    if (detection.architecture === "arm64") {
      if (optionIds.has("mac-arm64")) return "mac-arm64";
      if (optionIds.has("mac-universal")) return "mac-universal";
    }
    if (detection.architecture === "x64") {
      if (optionIds.has("mac-x64")) return "mac-x64";
      if (optionIds.has("mac-universal")) return "mac-universal";
    }
    if (detection.architecture === "unknown") {
      if (optionIds.has("mac-universal")) return "mac-universal";
    }
  }

  if (detection.platform === "windows") {
    if (detection.architecture === "arm64") {
      if (optionIds.has("win-arm64")) return "win-arm64";
      if (optionIds.has("win-x64")) return "win-x64";
    }
    if (detection.architecture === "x64") {
      if (optionIds.has("win-x64")) return "win-x64";
    }
  }

  return null;
}

export function detectPlatformForManifest(
  manifest: AppDownloadManifest,
  navigatorLikeOrContext?: PlatformNavigatorLike | DeepDetectionContext,
): PlatformDetection {
  const detected = detectPlatform(navigatorLikeOrContext);
  return {
    ...detected,
    recommendedId: getRecommendedOptionId(manifest.options, detected),
  };
}

export async function detectPlatformAsync(
  navigatorLikeOrContext?: PlatformNavigatorLike | DeepDetectionContext,
): Promise<Omit<PlatformDetection, "recommendedId">> {
  const syncResult = detectPlatform(navigatorLikeOrContext);
  const { nav } = resolveContext(navigatorLikeOrContext);

  const uaData = nav?.userAgentData;
  if (typeof uaData?.getHighEntropyValues === "function") {
    try {
      const entropy = await uaData.getHighEntropyValues([
        "architecture",
        "bitness",
        "platform",
        "platformVersion",
        "model",
      ]);

      const entropyArch =
        typeof entropy.architecture === "string"
          ? entropy.architecture.toLowerCase()
          : "";

      let resolvedPlatform = syncResult.platform;
      if (entropy.platform) {
        if (/windows/i.test(entropy.platform)) resolvedPlatform = "windows";
        else if (/mac/i.test(entropy.platform)) resolvedPlatform = "macos";
      }

      let resolvedArch = syncResult.architecture;
      if (entropyArch === "arm") {
        resolvedArch = "arm64";
      } else if (entropyArch === "x86") {
        if (
          syncResult.platform === "macos" &&
          syncResult.architecture === "arm64"
        ) {
          resolvedArch = "arm64";
        } else {
          resolvedArch = "x64";
        }
      }

      return {
        platform: resolvedPlatform,
        architecture: resolvedArch,
      };
    } catch {
      // Fallback to sync result
    }
  }

  return syncResult;
}

export async function detectPlatformForManifestAsync(
  manifest: AppDownloadManifest,
  navigatorLikeOrContext?: PlatformNavigatorLike | DeepDetectionContext,
): Promise<PlatformDetection> {
  const detected = await detectPlatformAsync(navigatorLikeOrContext);
  return {
    ...detected,
    recommendedId: getRecommendedOptionId(manifest.options, detected),
  };
}

export function usePlatformDetection(
  manifest: AppDownloadManifest | null | undefined,
): PlatformDetection {
  const [detection, setDetection] = useState<PlatformDetection>(() => {
    if (!manifest) {
      const detected = detectPlatform();
      return {
        ...detected,
        recommendedId: null,
      };
    }
    return detectPlatformForManifest(manifest);
  });

  useEffect(() => {
    if (!manifest) return;

    const syncDetection = detectPlatformForManifest(manifest);
    setDetection(syncDetection);

    let isMounted = true;
    void detectPlatformForManifestAsync(manifest).then((asyncDetection) => {
      if (
        isMounted &&
        (asyncDetection.platform !== syncDetection.platform ||
          asyncDetection.architecture !== syncDetection.architecture ||
          asyncDetection.recommendedId !== syncDetection.recommendedId)
      ) {
        setDetection(asyncDetection);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [manifest]);

  return detection;
}
