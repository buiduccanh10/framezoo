import { afterEach, describe, expect, it } from "vitest";

import { getLandingCopy } from "./i18n";
import { applyLandingSeo } from "./seo";

afterEach(() => {
  document.title = "";
  document.head.innerHTML = "";
});

describe("landing SEO", () => {
  it("uses search-focused English metadata", () => {
    applyLandingSeo("en");

    expect(document.title).toBe("Framezoo Player | AI Subtitle Sync");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="description"]')
        ?.content,
    ).toContain("player");
    expect(
      document.querySelector<HTMLMetaElement>('meta[property="og:image:alt"]')
        ?.content,
    ).toBe("Framezoo player");
    expect(
      document.querySelector<HTMLMetaElement>('meta[property="og:locale"]')
        ?.content,
    ).toBe("en_US");
  });

  it("updates localized title and social metadata", () => {
    applyLandingSeo("vi");

    expect(document.title).toBe("Một nơi xem phim đúng ý bạn. | Framezoo");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="description"]')
        ?.content,
    ).toBe(getLandingCopy("vi").hero.description);
    expect(
      document.querySelector<HTMLMetaElement>('meta[property="og:title"]')
        ?.content,
    ).toBe("Một nơi xem phim đúng ý bạn. | Framezoo");
    expect(
      document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
    ).toBe("https://framezoo.top/");
  });
});
