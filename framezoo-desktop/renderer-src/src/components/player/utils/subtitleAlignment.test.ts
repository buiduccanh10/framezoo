import { describe, expect, it } from "vitest";

import { parseCanonicalVtt } from "./captions";
import {
  type SubtitleAlignmentResponse,
  applySubtitleAlignment,
  selectSubtitleAlignmentConsensus,
} from "./subtitleAlignment";

const baseResult: SubtitleAlignmentResponse = {
  aligned: true,
  offsetMs: -2000,
  confidence: 90,
  speechIntervals: [],
  cleanedVtt: "",
  reason: null,
};

describe("subtitle alignment", () => {
  it("applies a negative offset when the downloaded subtitle is late", () => {
    const vtt = `WEBVTT

00:00:05.000 --> 00:00:07.000
Hello`;

    const aligned = applySubtitleAlignment(vtt, baseResult);
    const [cue] = parseCanonicalVtt(aligned);

    expect([cue.start, cue.end]).toEqual([3000, 5000]);
  });

  it("uses cleaned VTT without changing the alignment sign", () => {
    const result = {
      ...baseResult,
      cleanedVtt: `WEBVTT

00:00:05.000 --> 00:00:07.000
Hello`,
    };

    const aligned = applySubtitleAlignment("WEBVTT", result);
    expect(aligned).toContain("00:00:03.000 --> 00:00:05.000");
  });

  it("keeps the original VTT when alignment confidence is insufficient", () => {
    const vtt = `WEBVTT

00:00:05.000 --> 00:00:07.000
Hello`;
    const result = {
      ...baseResult,
      aligned: false,
      confidence: 20,
      cleanedVtt: "WEBVTT",
    };

    expect(applySubtitleAlignment(vtt, result)).toBe(vtt);
  });

  it("accepts two nearby windows and averages their offsets", () => {
    const vtt = "WEBVTT";
    const result = selectSubtitleAlignmentConsensus(vtt, [
      { ...baseResult, offsetMs: -2000, confidence: 80 },
      { ...baseResult, offsetMs: -2300, confidence: 70 },
      { ...baseResult, offsetMs: 30_000, confidence: 100 },
    ]);

    expect(result.aligned).toBe(true);
    expect(result.offsetMs).toBe(-2150);
    expect(result.confidence).toBe(75);
  });

  it("rejects windows that do not reach offset consensus", () => {
    const vtt = `WEBVTT

00:00:05.000 --> 00:00:07.000
Hello`;
    const result = selectSubtitleAlignmentConsensus(vtt, [
      { ...baseResult, offsetMs: -2000, confidence: 90 },
      { ...baseResult, offsetMs: 10_000, confidence: 90 },
    ]);

    expect(result.aligned).toBe(false);
    expect(result.reason).toBe("insufficient_consensus");
    expect(result.cleanedVtt).toBe(vtt);
  });

  it("aligns a track independently when its offset differs from primary", () => {
    const vtt = "WEBVTT";
    const result = selectSubtitleAlignmentConsensus(vtt, [
      { ...baseResult, offsetMs: 12_000, confidence: 90 },
      { ...baseResult, offsetMs: 12_200, confidence: 90 },
    ]);

    expect(result.aligned).toBe(true);
    expect(result.offsetMs).toBe(12_100);
    expect(result.reason).toBeNull();
  });
});
