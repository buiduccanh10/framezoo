import { describe, expect, it } from "vitest";

import { parseCanonicalVtt } from "@/components/player/utils/captions";
import type { Caption } from "@/stores/player/slices/source";

import { type TranslateService, translate } from "./index";

const mockService: TranslateService = {
  getName: () => "mock",
  getConfig: () => ({
    single: {
      batchSize: 10,
      batchDelayMs: 0,
    },
    multi: {
      batchSize: 10,
      batchDelayMs: 0,
    },
    maxRetryCount: 1,
  }),
  translate: async (str) => `${str} (vi)`,
  translateMulti: async (batch) => batch.map((str) => `${str} (vi)`),
};

describe("translation canonical VTT flow", () => {
  it("translates VTT captions and keeps WebVTT output", async () => {
    const caption: Caption = {
      id: "translation-vtt-caption",
      language: "en",
      vttData: `WEBVTT

00:00:01.000 --> 00:00:02.500
Hello world`,
    };

    const result = await translate(caption, "vi", mockService);

    expect(result).toBeDefined();
    expect(result?.startsWith("WEBVTT")).toBe(true);

    const cues = parseCanonicalVtt(result!);
    expect(cues).toHaveLength(1);
    expect(cues[0].content).toBe("Hello world (vi)");
  });
});
