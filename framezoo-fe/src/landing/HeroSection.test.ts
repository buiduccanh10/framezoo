import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { HeroSection, formatDownloadCount } from "./HeroSection";
import { getLandingCopy } from "./i18n";
import { LandingFooter } from "./LandingFooter";
import { readCachedManifest, writeCachedManifest } from "./useDownloadManifest";

afterEach(() => {
  window.localStorage.clear();
});

describe("formatDownloadCount", () => {
  it("formats counts under 100 with a plus", () => {
    expect(formatDownloadCount(42)).toBe("42+");
  });

  it("rounds counts between 100 and 999 to the nearest lower 10 with a plus", () => {
    expect(formatDownloadCount(593)).toBe("590+");
    expect(formatDownloadCount(605)).toBe("600+");
    expect(formatDownloadCount(100)).toBe("100+");
  });

  it("formats counts 1000 and above into thousands with k+", () => {
    expect(formatDownloadCount(1000)).toBe("1k+");
    expect(formatDownloadCount(1050)).toBe("1.1k+");
    expect(formatDownloadCount(4324)).toBe("4.3k+");
  });
});

describe("HeroSection & LandingFooter", () => {
  it("renders meta skeleton while loading and version + download count once ready", () => {
    const copy = getLandingCopy("en");
    const loadingHtml = renderToStaticMarkup(
      createElement(HeroSection, {
        copy: copy.hero,
        movieCopy: copy.movies,
        onHashLinkClick: () => {},
        version: null,
        totalDownloads: null,
        isMetaLoading: true,
      }),
    );
    expect(loadingHtml).toContain("landing-hero-meta-skeleton");

    const readyHtml = renderToStaticMarkup(
      createElement(HeroSection, {
        copy: copy.hero,
        movieCopy: copy.movies,
        onHashLinkClick: () => {},
        version: "2.2.8",
        totalDownloads: 632,
        isMetaLoading: false,
      }),
    );
    expect(readyHtml).toContain("v2.2.8");
    expect(readyHtml).toContain("630+");
    expect(readyHtml).not.toContain("landing-hero-meta-skeleton");
  });

  it("renders TikTok and Threads links in the landing footer", () => {
    const html = renderToStaticMarkup(
      createElement(LandingFooter, { copy: getLandingCopy("en") }),
    );
    expect(html).toContain("https://www.tiktok.com/@framezoo.top");
    expect(html).toContain("https://www.threads.com/@framezoo.top");
  });
});

describe("download manifest cache", () => {
  it("stores valid manifests and ignores invalid or empty entries", () => {
    const backendUrl = "https://api.example.com";
    const manifest = {
      version: "2.2.8",
      totalDownloads: 630,
      options: [
        {
          id: "mac-arm64" as const,
          label: "macOS Apple Silicon",
          description: "For Apple Silicon Macs",
          url: "https://api.example.com/download/mac-arm64",
        },
      ],
    };

    writeCachedManifest(backendUrl, manifest);
    expect(readCachedManifest(backendUrl)).toEqual(manifest);

    writeCachedManifest(backendUrl, { ...manifest, options: [] });
    expect(readCachedManifest(backendUrl)).toBeNull();

    window.localStorage.setItem(
      `framezoo:download-manifest:${backendUrl}`,
      "{broken",
    );
    expect(readCachedManifest(backendUrl)).toBeNull();
  });
});
