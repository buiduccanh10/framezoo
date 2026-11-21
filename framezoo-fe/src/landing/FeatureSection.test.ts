import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FeatureSection } from "./FeatureSection";
import { getLandingCopy } from "./i18n";

describe("FeatureSection showcase media", () => {
  it("renders the two optimized showcase videos and posters in order", () => {
    const copy = getLandingCopy("vi").features;
    const html = renderToStaticMarkup(
      createElement(FeatureSection, { copy, variant: "all" }),
    );

    const firstVideoIndex = html.indexOf('src="/showcase-detail.mp4"');
    const secondVideoIndex = html.indexOf('src="/showcase-discovery.mp4"');

    expect(firstVideoIndex).toBeGreaterThan(-1);
    expect(secondVideoIndex).toBeGreaterThan(firstVideoIndex);
    expect(html).toContain('poster="/showcase-detail-poster.jpg"');
    expect(html).toContain('poster="/showcase-discovery-poster.jpg"');
    expect(html).toContain(copy.showcasePrimaryAlt);
    expect(html).toContain(copy.showcaseSecondaryAlt);
    expect(html).not.toContain("landing-app-sim");
  });

  it("omits showcase media when variant is experience", () => {
    const copy = getLandingCopy("en").features;
    const html = renderToStaticMarkup(
      createElement(FeatureSection, { copy, variant: "experience" }),
    );

    expect(html).not.toContain("showcase-detail.mp4");
    expect(html).not.toContain("showcase-discovery.mp4");
  });
});
