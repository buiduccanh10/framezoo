import { describe, expect, it } from "vitest";

import {
  getExternalSubtitleLanguageKey,
  normalizeExternalSubtitleLanguage,
} from "./language";

describe("external subtitle language key", () => {
  it("normalizes ISO 639-1, ISO 639-3, and regional values", () => {
    expect(normalizeExternalSubtitleLanguage("vi-VN")).toBe("vi");
    expect(normalizeExternalSubtitleLanguage("vie")).toBe("vi");
    expect(normalizeExternalSubtitleLanguage("")).toBeUndefined();
  });

  it("deduplicates and sorts languages used by Wyzie", () => {
    expect(getExternalSubtitleLanguageKey("vie", "vi")).toBe("vi");
    expect(getExternalSubtitleLanguageKey("en", "vi")).toBe("en,vi");
  });
});
