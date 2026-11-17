import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FeatureSection } from "./FeatureSection";
import { getLandingCopy } from "./i18n";

describe("FeatureSection showcase GIFs", () => {
  it("renders the two showcase GIFs in order instead of AppPreviewShowcase", () => {
    const copy = getLandingCopy("vi").features;
    const html = renderToStaticMarkup(
      createElement(FeatureSection, { copy, variant: "all" }),
    );

    const firstGifIndex = html.indexOf(
      'src="/Snapzy_Recording_2026-11-17_22-40-18.gif"',
    );
    const secondGifIndex = html.indexOf(
      'src="/Snapzy_Recording_2026-11-17_22-41-21.gif"',
    );

    expect(firstGifIndex).toBeGreaterThan(-1);
    expect(secondGifIndex).toBeGreaterThan(firstGifIndex);
    expect(html).toContain(copy.showcasePrimaryAlt);
    expect(html).toContain(copy.showcaseSecondaryAlt);
    expect(html).not.toContain("landing-app-sim");
  });

  it("omits showcase GIFs when variant is experience", () => {
    const copy = getLandingCopy("en").features;
    const html = renderToStaticMarkup(
      createElement(FeatureSection, { copy, variant: "experience" }),
    );

    expect(html).not.toContain("Snapzy_Recording_2026-11-17_22-40-18.gif");
    expect(html).not.toContain("Snapzy_Recording_2026-11-17_22-41-21.gif");
  });
});
