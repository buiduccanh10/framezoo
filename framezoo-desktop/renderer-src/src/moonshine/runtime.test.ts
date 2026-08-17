import { describe, expect, it, vi } from "vitest";

import {
  MoonshineLanguageUnavailableError,
  ensureMoonshineModel,
  normalizeMoonshineLanguage,
} from "./runtime";

describe("Moonshine language normalization", () => {
  it("maps ISO-639-3 audio track codes to catalog languages", () => {
    expect(normalizeMoonshineLanguage("eng")).toBe("en");
    expect(normalizeMoonshineLanguage("kor-KR")).toBe("ko");
  });

  it("keeps standard language-region codes on their base language", () => {
    expect(normalizeMoonshineLanguage("ja-JP")).toBe("ja");
  });

  it("reports languages missing from the local catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: {} }),
      }),
    );

    await expect(ensureMoonshineModel("fr")).rejects.toMatchObject({
      name: "MoonshineLanguageUnavailableError",
      language: "fr",
    });
    await expect(ensureMoonshineModel("fr")).rejects.toBeInstanceOf(
      MoonshineLanguageUnavailableError,
    );
  });
});
