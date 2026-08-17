import { describe, expect, it, vi } from "vitest";

import {
  MoonshineLanguageUnavailableError,
  decodeMoonshineWav,
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

describe("Moonshine WAV decoding", () => {
  it("reads the data chunk only and averages stereo PCM like the service", () => {
    const buffer = new ArrayBuffer(12 + 8 + 16 + 8 + 8 + 8 + 4);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    view.setUint32(4, buffer.byteLength - 8, true);
    bytes.set([0x57, 0x41, 0x56, 0x45], 8);
    bytes.set([0x66, 0x6d, 0x74, 0x20], 12);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, 16_000, true);
    view.setUint32(28, 64_000, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    bytes.set([0x64, 0x61, 0x74, 0x61], 36);
    view.setUint32(40, 8, true);
    view.setInt16(44, 16_384, true);
    view.setInt16(46, -16_384, true);
    view.setInt16(48, 16_384, true);
    view.setInt16(50, 16_384, true);
    bytes.set([0x4a, 0x55, 0x4e, 0x4b], 52);
    view.setUint32(56, 4, true);
    view.setUint32(60, 0, true);

    const decoded = decodeMoonshineWav(new Uint8Array(buffer));

    expect(decoded.sampleRate).toBe(16_000);
    expect(decoded.durationMs).toBe(0);
    expect([...decoded.samples]).toEqual([0, 0.5]);
  });

  it("rejects truncated PCM frames", () => {
    const buffer = new ArrayBuffer(44 + 1);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    view.setUint32(4, buffer.byteLength - 8, true);
    bytes.set([0x57, 0x41, 0x56, 0x45], 8);
    bytes.set([0x66, 0x6d, 0x74, 0x20], 12);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16_000, true);
    view.setUint32(28, 32_000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    bytes.set([0x64, 0x61, 0x74, 0x61], 36);
    view.setUint32(40, 1, true);

    expect(() => decodeMoonshineWav(new Uint8Array(buffer))).toThrow(
      "Audio data is not aligned to complete PCM frames",
    );
  });
});
