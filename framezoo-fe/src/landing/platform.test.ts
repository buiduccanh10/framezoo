import { describe, expect, it, vi } from "vitest";

import type { AppDownloadOption } from "@/backend/download";

import {
  detectFpuArchitecture,
  detectPlatform,
  detectPlatformAsync,
  detectPlatformForManifest,
  detectPlatformForManifestAsync,
  getRecommendedOptionId,
} from "./platform";

const options: AppDownloadOption[] = [
  {
    id: "mac-arm64",
    label: "macOS Apple Silicon",
    description: "M-series Macs",
    url: "https://example.com/mac-arm64",
  },
  {
    id: "mac-x64",
    label: "macOS Intel",
    description: "Intel Macs",
    url: "https://example.com/mac-x64",
  },
  {
    id: "mac-universal",
    label: "macOS Universal",
    description: "Both Mac architectures",
    url: "https://example.com/mac-universal",
  },
  {
    id: "win-x64",
    label: "Windows x64",
    description: "64-bit Windows PCs",
    url: "https://example.com/win-x64",
  },
  {
    id: "win-arm64",
    label: "Windows ARM64",
    description: "ARM Windows PCs",
    url: "https://example.com/win-arm64",
  },
];

describe("platform detection", () => {
  it("detects Windows x64", () => {
    expect(
      detectPlatform({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      }),
    ).toEqual({ platform: "windows", architecture: "x64" });
  });

  it("detects Windows ARM64 via userAgent", () => {
    expect(
      detectPlatform({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; ARM64)",
      }),
    ).toEqual({ platform: "windows", architecture: "arm64" });
  });

  it("detects Windows ARM64 via Snapdragon/Qualcomm WebGL GPU", () => {
    expect(
      detectPlatform({
        navigator: {
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        webGlRenderer: "Qualcomm Adreno 750",
      }),
    ).toEqual({ platform: "windows", architecture: "arm64" });
  });

  it("detects Windows ARM64 via FPU IEEE 754 probe", () => {
    expect(
      detectPlatform({
        navigator: {
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        fpuArchitecture: "arm64",
      }),
    ).toEqual({ platform: "windows", architecture: "arm64" });
  });

  it("detects Apple Silicon on macOS via FPU IEEE 754 probe (e.g. Safari / Firefox)", () => {
    expect(
      detectPlatform({
        navigator: {
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
        fpuArchitecture: "arm64",
      }),
    ).toEqual({ platform: "macos", architecture: "arm64" });
  });

  it("detects Intel Mac via FPU IEEE 754 probe", () => {
    expect(
      detectPlatform({
        navigator: {
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
        fpuArchitecture: "x64",
      }),
    ).toEqual({ platform: "macos", architecture: "x64" });
  });

  it("detects Apple Silicon on macOS via WebGL renderer", () => {
    expect(
      detectPlatform({
        navigator: {
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
        webGlRenderer: "ANGLE (Apple, Apple M3 Pro, OpenGL 4.1)",
      }),
    ).toEqual({ platform: "macos", architecture: "arm64" });
  });

  it("detects Intel Mac via WebGL renderer", () => {
    expect(
      detectPlatform({
        navigator: {
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
        webGlRenderer: "ANGLE (Intel Inc., Intel Iris Plus Graphics 650)",
      }),
    ).toEqual({ platform: "macos", architecture: "x64" });
  });

  it("detects Apple Silicon even when user runs x86 browser under Rosetta 2", () => {
    expect(
      detectPlatform({
        navigator: {
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          userAgentData: { platform: "macOS", architecture: "x86" },
        },
        webGlRenderer: "ANGLE (Apple, Apple M1, OpenGL 4.1)",
      }),
    ).toEqual({ platform: "macos", architecture: "arm64" });
  });

  it("distinguishes iPad from desktop Mac when requesting desktop website", () => {
    expect(
      detectPlatform({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        maxTouchPoints: 5,
      }),
    ).toEqual({ platform: "other", architecture: "unknown" });
  });

  it("identifies iPhone as other platform", () => {
    expect(
      detectPlatform({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      }),
    ).toEqual({ platform: "other", architecture: "unknown" });
  });

  it("recommends the exact macOS architecture when user agent data exposes it", () => {
    expect(
      detectPlatformForManifest(
        { version: "1.0.0", options },
        {
          userAgent: "Mozilla/5.0 (Macintosh; Mac OS X 14_0)",
          userAgentData: { platform: "macOS", architecture: "arm" },
        },
      ).recommendedId,
    ).toBe("mac-arm64");

    expect(
      detectPlatformForManifest(
        { version: "1.0.0", options },
        {
          userAgent: "Mozilla/5.0 (Macintosh; Mac OS X 14_0)",
          userAgentData: { platform: "macOS", architecture: "x86" },
        },
      ).recommendedId,
    ).toBe("mac-x64");
  });

  it("recommends exact macOS architecture when detected via hardware/WebGL probe in Safari", () => {
    expect(
      detectPlatformForManifest(
        { version: "1.0.0", options },
        {
          navigator: {
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          },
          fpuArchitecture: "arm64",
          webGlRenderer: "Apple GPU",
        },
      ).recommendedId,
    ).toBe("mac-arm64");

    expect(
      detectPlatformForManifest(
        { version: "1.0.0", options },
        {
          navigator: {
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          },
          fpuArchitecture: "x64",
          webGlRenderer: "Intel Iris Graphics",
        },
      ).recommendedId,
    ).toBe("mac-x64");
  });

  it("recommends the exact Windows architecture", () => {
    expect(
      detectPlatformForManifest(
        { version: "1.0.0", options },
        { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      ).recommendedId,
    ).toBe("win-x64");

    expect(
      detectPlatformForManifest(
        { version: "1.0.0", options },
        { userAgent: "Mozilla/5.0 (Windows NT 10.0; ARM64)" },
      ).recommendedId,
    ).toBe("win-arm64");
  });

  it("recommends mac-universal when architecture is unknown on Mac", () => {
    expect(
      detectPlatformForManifest(
        { version: "1.0.0", options },
        { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
      ).recommendedId,
    ).toBe("mac-universal");
  });

  it("does not recommend a build when architecture is unknown and universal build is missing", () => {
    const optionsWithoutUniversal = options.filter(
      (opt) => opt.id !== "mac-universal",
    );
    expect(
      detectPlatformForManifest(
        { version: "1.0.0", options: optionsWithoutUniversal },
        { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
      ).recommendedId,
    ).toBeNull();
  });

  it("falls back to mac-universal when specific architecture build is missing", () => {
    const universalOnly: AppDownloadOption[] = [
      {
        id: "mac-universal",
        label: "macOS Universal",
        description: "Both architectures",
        url: "https://example.com/mac-universal",
      },
      {
        id: "win-x64",
        label: "Windows x64",
        description: "Windows",
        url: "https://example.com/win-x64",
      },
    ];

    expect(
      detectPlatformForManifest(
        { version: "1.0.0", options: universalOnly },
        {
          userAgentData: { platform: "macOS", architecture: "arm" },
        },
      ).recommendedId,
    ).toBe("mac-universal");
  });

  it("falls back from win-arm64 to win-x64 when win-arm64 is not published", () => {
    const winX64Only: AppDownloadOption[] = [
      {
        id: "win-x64",
        label: "Windows x64",
        description: "Windows",
        url: "https://example.com/win-x64",
      },
    ];

    expect(
      detectPlatformForManifest(
        { version: "1.0.0", options: winX64Only },
        {
          userAgent: "Mozilla/5.0 (Windows NT 10.0; ARM64)",
        },
      ).recommendedId,
    ).toBe("win-x64");
  });

  it("does not recommend a build when the platform is unknown or mobile", () => {
    expect(
      getRecommendedOptionId(options, {
        platform: "other",
        architecture: "unknown",
      }),
    ).toBeNull();

    expect(
      detectPlatformForManifest(
        { version: "1.0.0", options },
        {
          userAgent:
            "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        },
      ).recommendedId,
    ).toBeNull();
  });

  it("detects architecture with FPU directly", () => {
    const arch = detectFpuArchitecture();
    // On the test runner machine (macOS arm64 or x64), it must be one of arm64 or x64
    expect(["arm64", "x64"]).toContain(arch);
  });

  it("asynchronously queries high entropy values in Chromium", async () => {
    const mockGetHighEntropyValues = vi.fn().mockResolvedValue({
      architecture: "arm",
      bitness: "64",
      platform: "macOS",
    });

    const result = await detectPlatformAsync({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      userAgentData: {
        platform: "macOS",
        getHighEntropyValues: mockGetHighEntropyValues,
      },
    });

    expect(mockGetHighEntropyValues).toHaveBeenCalledWith([
      "architecture",
      "bitness",
      "platform",
      "platformVersion",
      "model",
    ]);
    expect(result).toEqual({ platform: "macos", architecture: "arm64" });

    const manifestResult = await detectPlatformForManifestAsync(
      { version: "1.0.0", options },
      {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        userAgentData: {
          platform: "macOS",
          getHighEntropyValues: mockGetHighEntropyValues,
        },
      },
    );
    expect(manifestResult.recommendedId).toBe("mac-arm64");
  });
});
