import { describe, expect, it } from "vitest";

import type { SegmentData } from "@/components/player/hooks/useSkipTime";

import {
  computeCaptionSourceFitScore,
  scoreCaptionSourceFit,
} from "./captionSourceFit";

const baseSegments: SegmentData[] = [
  {
    type: "intro",
    start_ms: 0,
    end_ms: 30_000,
    confidence: 1,
    submission_count: 1,
  },
  {
    type: "credits",
    start_ms: 570_000,
    end_ms: 600_000,
    confidence: 1,
    submission_count: 1,
  },
];

describe("computeCaptionSourceFitScore", () => {
  it("prefers subtitles that fit the current source timeline", () => {
    const goodFit = computeCaptionSourceFitScore(
      [
        {
          type: "caption",
          index: 0,
          start: 32_000,
          end: 36_000,
          duration: 4_000,
          text: "",
          content: "A",
        },
        {
          type: "caption",
          index: 1,
          start: 120_000,
          end: 124_000,
          duration: 4_000,
          text: "",
          content: "B",
        },
        {
          type: "caption",
          index: 2,
          start: 540_000,
          end: 548_000,
          duration: 8_000,
          text: "",
          content: "C",
        },
      ],
      {
        videoDurationMs: 600_000,
        segments: baseSegments,
      },
    );

    const badFit = computeCaptionSourceFitScore(
      [
        {
          type: "caption",
          index: 0,
          start: 5_000,
          end: 12_000,
          duration: 7_000,
          text: "",
          content: "A",
        },
        {
          type: "caption",
          index: 1,
          start: 560_000,
          end: 599_000,
          duration: 39_000,
          text: "",
          content: "B",
        },
        {
          type: "caption",
          index: 2,
          start: 650_000,
          end: 658_000,
          duration: 8_000,
          text: "",
          content: "C",
        },
      ],
      {
        videoDurationMs: 600_000,
        segments: baseSegments,
      },
    );

    expect(goodFit).not.toBeNull();
    expect(badFit).not.toBeNull();
    expect((goodFit?.score ?? 0) > (badFit?.score ?? 0)).toBe(true);
    expect(goodFit?.confidence).toBe("medium");
  });

  it("treats non-opensubtitles tracks as same-source high confidence", async () => {
    const score = await scoreCaptionSourceFit(
      {
        id: "source-track",
        language: "en",
        url: "https://example.com/source.vtt",
        needsProxy: false,
        opensubtitles: false,
      },
      {
        videoDurationMs: 600_000,
        segments: baseSegments,
      },
    );

    expect(score).toEqual({
      score: 100,
      confidence: "high",
      breakdown: {
        durationFit: null,
        introFit: null,
        creditsFit: null,
      },
    });
  });
});
