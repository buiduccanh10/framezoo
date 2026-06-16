import { describe, expect, it } from "vitest";

import { labelToLanguageCode } from "@/lib/providers";

import {
  canonicalizeLanguageCode,
  getCaptionLanguageGroupKey,
  inferCaptionLanguageFromItems,
  normalizeCaptionLanguage,
} from "./captionLanguage";

describe("caption language normalization", () => {
  it("maps common external subtitle labels to real language codes", () => {
    expect(labelToLanguageCode("English")).toBe("en");
    expect(labelToLanguageCode("Spanish (Latin America)")).toBe("es-419");
    expect(labelToLanguageCode("Brazilian Portuguese")).toBe("pt-br");
    expect(labelToLanguageCode("pob")).toBe("pt-br");
  });

  it("rejects invalid shorthand codes instead of inventing bogus ones", () => {
    expect(labelToLanguageCode("sp")).toBeNull();
    expect(normalizeCaptionLanguage("sp")).toBeNull();
    expect(canonicalizeLanguageCode("sp")).toBe("unknown");
  });

  it("falls back to display labels when raw provider codes are invalid", () => {
    expect(
      getCaptionLanguageGroupKey({
        language: "sp",
        display: "Spanish (Latin America)",
      }),
    ).toBe("es");

    expect(
      getCaptionLanguageGroupKey({
        language: "pob",
        display: "Brazilian Portuguese",
      }),
    ).toBe("pt");
  });

  it("infers a stable header language from unknown groups when all items agree", () => {
    expect(
      inferCaptionLanguageFromItems([
        { language: "hi", display: "Hindi" },
        { language: "", display: "Hindi" },
      ]),
    ).toBe("hi");

    expect(
      inferCaptionLanguageFromItems([
        { language: "hi", display: "Hindi" },
        { language: "ar", display: "Arabic" },
      ]),
    ).toBeNull();
  });
});
