import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getLandingCopy } from "./i18n";
import { LEGAL_OPERATOR } from "./legalOperator";
import { getLegalTabFromPathname } from "./LegalPage";

describe("Landing legal compliance & install guide hygiene", () => {
  it("resolves legal routes including disclaimer and dmca aliases", () => {
    expect(getLegalTabFromPathname("/legal/terms")).toBe("terms");
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
});
