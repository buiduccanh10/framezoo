import { afterEach, describe, expect, it } from "vitest";

import { getLandingCopy } from "./i18n";
import { applyLandingSeo, getLandingSeoMetadata } from "./seo";

afterEach(() => {
  document.title = "";
  document.head.innerHTML = "";
});

describe("landing SEO", () => {
  it("uses search-focused English metadata", () => {
    applyLandingSeo("en");

    expect(document.title).toBe("Framezoo - Fast & Smooth Video Streaming");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="description"]')
        ?.content,
    ).toContain("high-speed video streaming player");
    expect(
      document.querySelector<HTMLMetaElement>('meta[property="og:image:alt"]')
        ?.content,
    ).toBe("Framezoo player");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content,
    ).toBe("index,follow,max-image-preview:large");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="thumbnail"]')
        ?.content,
    ).toBe("https://framezoo.top/og-preview.jpg");
    expect(
      document.querySelector<HTMLMetaElement>('meta[property="og:image:width"]')
        ?.content,
    ).toBe("1024");
    expect(
      document.querySelector<HTMLMetaElement>(
        'meta[property="og:image:height"]',
      )?.content,
    ).toBe("595");
    expect(
      document.querySelector<HTMLMetaElement>('meta[property="og:locale"]')
        ?.content,
    ).toBe("en_US");
  });

  it("updates localized title and social metadata", () => {
    applyLandingSeo("vi");

    expect(document.title).toBe("Framezoo - Trình phát Stream tốc độ cao");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="description"]')
        ?.content,
    ).toBe(getLandingCopy("vi").seo.description);
    expect(
      document.querySelector<HTMLMetaElement>('meta[property="og:title"]')
        ?.content,
    ).toBe("Framezoo - Trình phát Stream tốc độ cao");
    expect(
      document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
    ).toBe("https://framezoo.top/");
  });

  it("keeps distinct category titles aligned with prerendered routes", () => {
    expect(getLandingSeoMetadata("en", "download")).toMatchObject({
      title: "Downloads | Framezoo",
      canonical: "https://framezoo.top/download",
    });
    expect(getLandingSeoMetadata("en", "experience").title).toBe(
      "Features & Experience | Framezoo",
    );
    expect(getLandingSeoMetadata("en", "ecosystem").title).toBe(
      "Addon Ecosystem | Framezoo",
    );
    expect(getLandingSeoMetadata("en", "create-addon").title).toBe(
      "Build an Addon | Framezoo",
    );
  });
});
