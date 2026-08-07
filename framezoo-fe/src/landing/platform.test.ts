import { describe, expect, it } from "vitest";

import type { AppDownloadOption } from "@/backend/download";

import {
  detectPlatform,
  detectPlatformForManifest,
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

  it("detects Windows ARM64", () => {
    expect(
      detectPlatform({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; ARM64)",
      }),
    ).toEqual({ platform: "windows", architecture: "arm64" });
  });

  it("does not recommend a Mac build when Safari hides the architecture", () => {
    expect(
      detectPlatformForManifest(
        { version: "1.0.0", options },
        { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
      ).recommendedId,
    ).toBeNull();
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

  it("does not recommend a build when the platform is unknown", () => {
    expect(
      getRecommendedOptionId(options, {
        platform: "other",
        architecture: "unknown",
      }),
    ).toBeNull();
  });
});
