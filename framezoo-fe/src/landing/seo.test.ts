import { afterEach, describe, expect, it } from "vitest";

import { applyLandingSeo } from "./seo";

afterEach(() => {
  document.title = "";
  document.head.innerHTML = "";
});

describe("landing SEO", () => {
  it("updates localized title and social metadata", () => {
    applyLandingSeo("vi");

    expect(document.title).toBe("Một nơi xem phim đúng ý bạn. | Framezoo");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="description"]')
        ?.content,
    ).toContain("Khám phá, phát và chỉnh từng chi tiết");
    expect(
      document.querySelector<HTMLMetaElement>('meta[property="og:title"]')
        ?.content,
    ).toBe("Một nơi xem phim đúng ý bạn. | Framezoo");
    expect(
      document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
    ).toBe("https://framezoo.top/");
  });
});
