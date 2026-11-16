import fs from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LANDING_LOCALES, getLandingCopy } from "./i18n";
import { InstallGuidePage } from "./InstallGuidePage";
import { LEGAL_OPERATOR } from "./legalOperator";
import { LegalPage, getLegalTabFromPathname } from "./LegalPage";

describe("Landing legal compliance & install guide hygiene", () => {
  it("resolves legal routes including disclaimer and dmca aliases", () => {
    expect(getLegalTabFromPathname("/legal/terms")).toBe("terms");
    expect(getLegalTabFromPathname("/legal/about")).toBe("terms");
    expect(getLegalTabFromPathname("/legal/privacy")).toBe("privacy");
    expect(getLegalTabFromPathname("/legal/dmca")).toBe("copyright");
    expect(getLegalTabFromPathname("/legal/disclaimer")).toBe("copyright");
    expect(getLegalTabFromPathname("/legal/addon-policy")).toBe("addon-policy");
    expect(getLegalTabFromPathname("/unknown")).toBeNull();
  });

  it("provides Vietnamese legal operator defaults and TMDB attribution copy", () => {
    expect(LEGAL_OPERATOR.operatorName).toContain("Bùi Đức Cảnh");
    expect(LEGAL_OPERATOR.phone).toBe("0984908816");
    expect(LEGAL_OPERATOR.contactEmail).toBe("framezoo.top@gmail.com");

    const viCopy = getLandingCopy("vi");
    const enCopy = getLandingCopy("en");
    expect(viCopy.footer.metadataAttribution).toContain("TMDB API");
    expect(enCopy.footer.metadataAttribution).toContain("TMDB API");
    expect(viCopy.legal.tabs.privacy.sections[3].paragraphs[0]).toContain("16");
  });

  it("shows the neutral intermediary P2P disclosure in the selected language", () => {
    for (const [locale, expected] of [
      ["vi", "không cài sẵn scraper hay tracker công cộng"],
      [
        "fr",
        "aucun module complémentaire de contenu par défaut ni tracker public",
      ],
    ]) {
      window.localStorage.setItem("framezoo-landing-locale", locale);
      const html = renderToStaticMarkup(
        createElement(LegalPage, { initialTab: "copyright" }),
      );
      expect(html).toContain(expected);
      expect(html).toContain("unchoke_slots_limit = 0, active_seeds = 0");
      expect(html).not.toContain("upload_rate_limit = 0");
    }
    window.localStorage.removeItem("framezoo-landing-locale");
  });

  it("keeps the no-default-trackers and no-seeding disclosure current in every locale", () => {
    for (const locale of LANDING_LOCALES) {
      const paragraph = getLandingCopy(locale.id).legal.tabs.copyright
        .sections[0].paragraphs[0];
      expect(paragraph, locale.id).not.toContain("upload_rate_limit = 0");
      expect(paragraph, locale.id).toContain(
        "unchoke_slots_limit = 0, active_seeds = 0",
      );
      expect(paragraph, locale.id).toMatch(/P2P|पी\s*2\s*पी/i);
    }
  });

  it("removes xattr bypass commands and open-source claims from install guide and locales", () => {
    const installGuideSource = fs.readFileSync(
      path.resolve(import.meta.dirname, "InstallGuidePage.tsx"),
      "utf8",
    );
    expect(installGuideSource).not.toContain("xattr -cr");

    const localesDir = path.resolve(import.meta.dirname, "locales");
    for (const file of fs.readdirSync(localesDir)) {
      const content = fs.readFileSync(path.join(localesDir, file), "utf8");
      const parsed = JSON.parse(content);
      const step2 = parsed.installGuide?.mac?.step2Desc || "";
      expect(step2).not.toMatch(
        /open[- ]?source|mã nguồn mở|開源|オープンソース/i,
      );
    }
  });

  it("renders unique legal H1 headings, crawlable tab links, and both OS guides in SSR", () => {
    window.localStorage.removeItem("framezoo-landing-locale");
    const addonHtml = renderToStaticMarkup(
      createElement(LegalPage, { initialTab: "addon-policy" }),
    );
    const termsHtml = renderToStaticMarkup(
      createElement(LegalPage, { initialTab: "terms" }),
    );
    expect(addonHtml).toContain(
      "<h1>Addon Policy &amp; Community Guidelines</h1>",
    );
    expect(termsHtml).toContain("<h1>Terms of Service</h1>");
    expect(addonHtml).toContain('href="/legal/terms"');

    const guideHtml = renderToStaticMarkup(createElement(InstallGuidePage));
    expect(guideHtml).toContain('id="mac"');
    expect(guideHtml).toContain('id="windows"');
    expect(guideHtml).toContain("Gatekeeper");
    expect(guideHtml).toContain("SmartScreen");
  });
});
