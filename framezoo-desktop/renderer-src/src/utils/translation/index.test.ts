import { describe, expect, it } from "vitest";

import { parseCanonicalVtt } from "@/components/player/utils/captions";
import type {
  Caption,
  SubtitleAlignmentState,
} from "@/stores/player/slices/source";

import {
  type TranslateService,
  applyStoredCaptionAlignment,
  translate,
} from "./index";

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

  it("reapplies a stored AI offset to translated base cues", () => {
    const alignment: SubtitleAlignmentState = {
      offsetMs: -2000,
    };
    const translated = applyStoredCaptionAlignment(
      `WEBVTT

00:00:05.000 --> 00:00:07.000
Xin chào`,
      alignment,
    );

    const [cue] = parseCanonicalVtt(translated);
    expect([cue.start, cue.end]).toEqual([3000, 5000]);
    expect(cue.content).toBe("Xin chào");
  });

  it("keeps piecewise AI alignment when translating a caption", () => {
    const alignment: SubtitleAlignmentState = {
      offsetMs: 0,
      segments: [
        { startMs: 0, endMs: 180_000, offsetMs: -1000 },
        { startMs: 180_000, endMs: Number.MAX_SAFE_INTEGER, offsetMs: 2000 },
      ],
    };
    const translated = applyStoredCaptionAlignment(
      `WEBVTT

00:00:05.000 --> 00:00:07.000
Intro

00:03:05.000 --> 00:03:07.000
Main`,
      alignment,
    );

    const cues = parseCanonicalVtt(translated);
    expect(cues.map((cue) => [cue.start, cue.end])).toEqual([
      [4000, 6000],
      [187_000, 189_000],
    ]);
  });
});
