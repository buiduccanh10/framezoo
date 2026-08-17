import { describe, expect, it } from "vitest";

import { parseCanonicalVtt } from "./captions";
import {
  SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS,
  type SubtitleAlignmentResponse,
  applySubtitleAlignment,
  areSubtitleAlignmentResultsApplicable,
  buildAlignmentWindowPlan,
  collectAlignmentWindowResponses,
  getSubtitleAlignmentBaseVtt,
  getSubtitleAlignmentInputVtt,
  getSubtitleAlignmentWindowDuration,
  selectSubtitleAlignmentConsensus,
} from "./subtitleAlignment";

const baseResult: SubtitleAlignmentResponse = {
  aligned: true,
  offsetMs: -2000,
  confidence: 90,
  speechIntervals: [{ startMs: 0, endMs: 1000 }],
  reason: null,
};

const primarySubtitle = [{ track: "primary" as const }];

function makeWindowResponse(result: Partial<SubtitleAlignmentResponse> = {}) {
  return {
    results: {
      primary: {
        ...baseResult,
        ...result,
      },
    },
  };
}

describe("subtitle alignment", () => {
  it("prioritizes independent current and buffered windows", () => {
    const plan = buildAlignmentWindowPlan(600, 3600, 900);

    expect(plan.slice(0, 2)).toEqual([
      { startAt: 600, priority: "nearby" },
      { startAt: 840, priority: "buffered" },
    ]);
    expect(plan.slice(2).map((window) => window.startAt)).toEqual([
      531, 1239, 1947, 2655,
    ]);
    for (let first = 0; first < plan.length; first += 1) {
      for (let second = first + 1; second < plan.length; second += 1) {
        expect(
          Math.abs(plan[second].startAt - plan[first].startAt),
        ).toBeGreaterThanOrEqual(SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS);
      }
    }
  });

  it("deduplicates clamped windows and caps fallback work", () => {
    const plan = buildAlignmentWindowPlan(0, 120);

    expect(plan.length).toBeLessThanOrEqual(6);
    expect(new Set(plan.map((window) => window.startAt)).size).toBe(
      plan.length,
    );
    expect(plan[0]).toEqual({ startAt: 0, priority: "nearby" });
  });

  it("uses half-file windows for short videos", () => {
    expect(getSubtitleAlignmentWindowDuration(90)).toBe(45);

    const plan = buildAlignmentWindowPlan(0, 90);

    expect(plan.slice(0, 2)).toEqual([
      { startAt: 0, priority: "nearby" },
      { startAt: 45, priority: "nearby" },
    ]);
  });

  it("keeps the default window when duration is unavailable", () => {
    expect(getSubtitleAlignmentWindowDuration(undefined)).toBe(
      SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS,
    );
    expect(getSubtitleAlignmentWindowDuration(Number.NaN)).toBe(
      SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS,
    );
  });

  it("does not create duplicate windows for zero or sub-second videos", () => {
    for (const duration of [0.5, 1.5]) {
      const plan = buildAlignmentWindowPlan(0, duration);

      expect(plan).toHaveLength(1);
      expect(new Set(plan.map((window) => window.startAt)).size).toBe(1);
    }
  });

  it("uses fallback windows when duration is unavailable", () => {
    expect(buildAlignmentWindowPlan(0, 0).length).toBeGreaterThan(1);
    expect(buildAlignmentWindowPlan(0, undefined).length).toBeGreaterThan(1);
  });

  it("does not duplicate a buffered range inside the current window", () => {
    const plan = buildAlignmentWindowPlan(600, 3600, 650);

    expect(plan.slice(0, 2)).toEqual([
      { startAt: 600, priority: "nearby" },
      { startAt: 540, priority: "nearby" },
    ]);
    expect(plan.some((window) => window.priority === "buffered")).toBe(false);
  });

  it("uses timeline anchors only after nearby and buffered windows", () => {
    const plan = buildAlignmentWindowPlan(600, 3600, 900);

    expect(plan).toHaveLength(6);
    expect(plan.slice(0, 2).map((window) => window.priority)).toEqual([
      "nearby",
      "buffered",
    ]);
    expect(
      plan.slice(2).every((window) => window.priority === "fallback"),
    ).toBe(true);
  });

  it("stops after two matching windows instead of extracting all anchors", async () => {
    const plan = buildAlignmentWindowPlan(600, 3600, 900);
    const requestedStarts: number[] = [];

    const responses = await collectAlignmentWindowResponses({
      windowPlan: plan,
      subtitles: primarySubtitle,
      requestWindow: async (window) => {
        requestedStarts.push(window.startAt);
        return makeWindowResponse({ offsetMs: -2000 });
      },
    });

    expect(responses).toHaveLength(2);
    expect(requestedStarts).toHaveLength(2);
  });

  it("opens fallback windows after no_speech_detected results", async () => {
    const plan = buildAlignmentWindowPlan(600, 3600, 900);
    const requestedStarts: number[] = [];

    const responses = await collectAlignmentWindowResponses({
      windowPlan: plan,
      subtitles: primarySubtitle,
      requestWindow: async (window) => {
        requestedStarts.push(window.startAt);
        if (requestedStarts.length <= 2) {
          return makeWindowResponse({
            aligned: false,
            confidence: 0,
            speechIntervals: [],
            reason: "no_speech_detected",
            offsetMs: 0,
          });
        }
        return makeWindowResponse({ offsetMs: -2000 });
      },
    });

    expect(responses).toHaveLength(4);
    expect(requestedStarts).toHaveLength(4);
    expect(requestedStarts[2]).not.toBe(requestedStarts[0]);
  });

  it("keeps searching when only one window has valid evidence", async () => {
    const plan = buildAlignmentWindowPlan(600, 3600, 900);
    let requestCount = 0;

    const responses = await collectAlignmentWindowResponses({
      windowPlan: plan,
      subtitles: primarySubtitle,
      requestWindow: async () => {
        requestCount += 1;
        return requestCount === 1
          ? makeWindowResponse({ offsetMs: -2000 })
          : makeWindowResponse({
              aligned: false,
              confidence: 0,
              speechIntervals: [],
              reason: "no_speech_detected",
              offsetMs: 0,
            });
      },
    });

    expect(responses).toHaveLength(6);
    expect(requestCount).toBe(6);
    expect(
      selectSubtitleAlignmentConsensus(
        responses
          .map(({ response }) => response.results.primary)
          .filter(
            (result): result is SubtitleAlignmentResponse =>
              result !== undefined,
          ),
      ).aligned,
    ).toBe(false);
  });

  it("applies a negative offset when the downloaded subtitle is late", () => {
    const vtt = `WEBVTT

00:00:05.000 --> 00:00:07.000
Hello`;

    const aligned = applySubtitleAlignment(vtt, baseResult);
    const [cue] = parseCanonicalVtt(aligned);

    expect([cue.start, cue.end]).toEqual([3000, 5000]);
  });

  it("applies the consensus offset to the original VTT", () => {
    const result = {
      ...baseResult,
    };

    const original = `WEBVTT

00:00:05.000 --> 00:00:07.000
Original`;
    const aligned = applySubtitleAlignment(original, result);
    expect(aligned).toContain("00:00:03.000 --> 00:00:05.000");
    expect(aligned).toContain("Original");
  });

  it("does not add the offset twice after a previous apply", () => {
    const original = `WEBVTT

00:00:05.000 --> 00:00:07.000
Original`;
    const shifted = applySubtitleAlignment(original, baseResult);
    const baseVtt = getSubtitleAlignmentBaseVtt({
      vttData: shifted,
      alignmentBaseVttData: original,
    });

    expect(applySubtitleAlignment(baseVtt, baseResult)).toBe(shifted);
  });

  it("analyzes translated captions against their canonical source timeline", () => {
    const sourceVtt = `WEBVTT

00:00:05.000 --> 00:00:07.000
Original`;
    const translatedVtt = `WEBVTT

00:00:04.500 --> 00:00:06.500
Translated`;

    expect(
      getSubtitleAlignmentInputVtt({
        vttData: translatedVtt,
        alignmentSourceVttData: sourceVtt,
      }),
    ).toBe(sourceVtt);
    expect(
      getSubtitleAlignmentBaseVtt({
        vttData: translatedVtt,
        alignmentSourceVttData: sourceVtt,
      }),
    ).toBe(translatedVtt);
  });

  it("rejects an atomic apply when one subtitle track fails", () => {
    expect(
      areSubtitleAlignmentResultsApplicable([
        {
          result: baseResult,
          expectedCaptionId: "primary",
          currentCaptionId: "primary",
        },
        {
          result: {
            ...baseResult,
            aligned: false,
            reason: "low_alignment_confidence",
          },
          expectedCaptionId: "secondary",
          currentCaptionId: "secondary",
        },
      ]),
    ).toBe(false);
  });

  it("keeps the original VTT when alignment confidence is insufficient", () => {
    const vtt = `WEBVTT

00:00:05.000 --> 00:00:07.000
Hello`;
    const result = {
      ...baseResult,
      aligned: false,
      confidence: 20,
    };

    expect(applySubtitleAlignment(vtt, result)).toBe(vtt);
  });

  it("accepts two nearby windows and averages their offsets", () => {
    const result = selectSubtitleAlignmentConsensus([
      { ...baseResult, offsetMs: -2000, confidence: 80 },
      { ...baseResult, offsetMs: -2300, confidence: 70 },
      { ...baseResult, offsetMs: 30_000, confidence: 100 },
    ]);

    expect(result.aligned).toBe(true);
    expect(result.offsetMs).toBe(-2150);
    expect(result.confidence).toBe(75);
  });

  it("rejects windows that do not reach offset consensus", () => {
    const result = selectSubtitleAlignmentConsensus([
      { ...baseResult, offsetMs: -2000, confidence: 90 },
      { ...baseResult, offsetMs: 10_000, confidence: 90 },
    ]);

    expect(result.aligned).toBe(false);
    expect(result.reason).toBe("insufficient_consensus");
  });

  it("aligns a track independently when its offset differs from primary", () => {
    const result = selectSubtitleAlignmentConsensus([
      { ...baseResult, offsetMs: 12_000, confidence: 90 },
      { ...baseResult, offsetMs: 12_200, confidence: 90 },
    ]);

    expect(result.aligned).toBe(true);
    expect(result.offsetMs).toBe(12_100);
    expect(result.reason).toBeNull();
  });

  it("requires two matching windows even when one window is strong", () => {
    const result = selectSubtitleAlignmentConsensus([
      {
        ...baseResult,
        offsetMs: 100,
        confidence: 88,
        speechAnchorCount: 4,
        speechAnchorCoverage: 1,
      },
      {
        ...baseResult,
        offsetMs: -72_050,
        confidence: 79,
        speechAnchorCoverage: 0.4,
      },
      {
        ...baseResult,
        offsetMs: -143_825,
        confidence: 82,
        speechAnchorCoverage: 0.5,
      },
    ]);

    expect(result.aligned).toBe(false);
    expect(result.reason).toBe("insufficient_consensus");
  });

  it("accepts two reliable windows with high speech coverage", () => {
    const result = selectSubtitleAlignmentConsensus([
      {
        ...baseResult,
        offsetMs: -6450,
        confidence: 73,
        speechAnchorCount: 7,
        speechAnchorCoverage: 0.875,
      },
      {
        ...baseResult,
        offsetMs: -6700,
        confidence: 72,
        speechAnchorCount: 6,
        speechAnchorCoverage: 0.8,
      },
    ]);

    expect(result.aligned).toBe(true);
    expect(result.offsetMs).toBe(-6575);
  });

  it("rejects a high-score single window with insufficient consensus", () => {
    const result = selectSubtitleAlignmentConsensus([
      {
        ...baseResult,
        offsetMs: -1225,
        confidence: 80,
        speechAnchorCount: 3,
        speechAnchorCoverage: 0.6,
      },
    ]);

    expect(result.aligned).toBe(false);
    expect(result.reason).toBe("insufficient_consensus");
  });

  it("rejects a single nearby window without strong speech anchors", () => {
    const result = selectSubtitleAlignmentConsensus([
      {
        ...baseResult,
        offsetMs: 100,
        confidence: 88,
        speechAnchorCount: 1,
        speechAnchorCoverage: 1,
      },
      { ...baseResult, offsetMs: -72_050, confidence: 79 },
    ]);

    expect(result.aligned).toBe(false);
  });

  it("rejects offsets outside the shared backend range", () => {
    const result = selectSubtitleAlignmentConsensus([
      {
        ...baseResult,
        offsetMs: -250_000,
        confidence: 90,
        speechAnchorCount: 4,
      },
    ]);

    expect(result.aligned).toBe(false);
  });

  it("accepts valid large cross-release offsets within plausible range", () => {
    const result = selectSubtitleAlignmentConsensus([
      {
        ...baseResult,
        offsetMs: -103_000,
        confidence: 85,
        speechAnchorCount: 3,
      },
      {
        ...baseResult,
        offsetMs: -103_200,
        confidence: 88,
        speechAnchorCount: 3,
      },
    ]);

    expect(result.aligned).toBe(true);
    expect(result.offsetMs).toBe(-103_100);
  });

  it("does not chain offsets beyond the tolerance into one consensus cluster", () => {
    const result = selectSubtitleAlignmentConsensus([
      { ...baseResult, offsetMs: 0 },
      { ...baseResult, offsetMs: 1300 },
      { ...baseResult, offsetMs: 2600 },
    ]);

    expect(result.aligned).toBe(false);
    expect(result.reason).toBe("insufficient_consensus");
  });

  it("reports no speech when every candidate has no speech evidence", () => {
    const result = selectSubtitleAlignmentConsensus([
      {
        ...baseResult,
        aligned: false,
        offsetMs: 0,
        confidence: 0,
        speechIntervals: [],
        reason: "no_speech_detected",
      },
      {
        ...baseResult,
        aligned: false,
        offsetMs: 0,
        confidence: 0,
        speechIntervals: [],
        reason: "no_speech_detected",
      },
    ]);

    expect(result.aligned).toBe(false);
    expect(result.reason).toBe("no_speech_detected");
  });

  it("does not accept two aligned windows without speech evidence", () => {
    const result = selectSubtitleAlignmentConsensus([
      { ...baseResult, speechIntervals: [] },
      { ...baseResult, offsetMs: -2300, speechIntervals: [] },
    ]);

    expect(result.aligned).toBe(false);
    expect(result.reason).toBe("no_speech_detected");
  });

  it("treats insufficient_speech_in_window as lacking speech evidence", () => {
    const result = selectSubtitleAlignmentConsensus([
      {
        ...baseResult,
        aligned: false,
        offsetMs: 0,
        confidence: 0,
        speechIntervals: [{ startMs: 0, endMs: 500 }],
        reason: "insufficient_speech_in_window",
      },
      {
        ...baseResult,
        aligned: false,
        offsetMs: 0,
        confidence: 0,
        speechIntervals: [{ startMs: 0, endMs: 800 }],
        reason: "insufficient_speech_in_window",
      },
    ]);

    expect(result.aligned).toBe(false);
    expect(result.reason).toBe("no_speech_detected");
  });

  it("opens fallback windows after insufficient_speech_in_window results", async () => {
    const plan = buildAlignmentWindowPlan(0, 3600);
    const requestedStarts: number[] = [];

    const responses = await collectAlignmentWindowResponses({
      windowPlan: plan,
      subtitles: primarySubtitle,
      requestWindow: async (window) => {
        requestedStarts.push(window.startAt);
        if (requestedStarts.length <= 2) {
          return makeWindowResponse({
            aligned: false,
            confidence: 0,
            speechIntervals: [{ startMs: 0, endMs: 600 }],
            reason: "insufficient_speech_in_window",
            offsetMs: 0,
          });
        }
        return makeWindowResponse({ offsetMs: -2000 });
      },
    });

    expect(responses).toHaveLength(4);
    expect(requestedStarts).toHaveLength(4);
    expect(requestedStarts[2]).toBeGreaterThan(120);
  });

  it("constructs piecewise alignment segments when intro and main movie have distinct offsets", () => {
    const rawVtt = `WEBVTT

00:00:06.000 --> 00:00:12.000
Watch Online Movies and Series for FREE www.osdb.link/lm

00:01:57.957 --> 00:02:00.896
Blood. Sometimes, it sets my teeth on edge.

00:02:01.514 --> 00:02:03.903
Other times, it helps me control the chaos.

00:07:50.500 --> 00:07:55.000
Episode dialogue in lab.
`;

    const windowEntries = [
      {
        startAt: 0,
        result: {
          aligned: true,
          offsetMs: -104000,
          confidence: 96,
          speechIntervals: [{ startMs: 14000, endMs: 20000 }],
          reason: null,
        },
      },
      {
        startAt: 473,
        result: {
          aligned: true,
          offsetMs: 2500,
          confidence: 94,
          speechIntervals: [{ startMs: 473000, endMs: 480000 }],
          reason: null,
        },
      },
      {
        startAt: 1104,
        result: {
          aligned: true,
          offsetMs: 2500,
          confidence: 90,
          speechIntervals: [{ startMs: 1104000, endMs: 1110000 }],
          reason: null,
        },
      },
    ];

    const result = selectSubtitleAlignmentConsensus(windowEntries);
    expect(result.aligned).toBe(true);
    expect(result.segments).toBeDefined();
    expect(result.segments).toHaveLength(2);
    expect(result.segments![0].offsetMs).toBe(-104000);
    expect(result.segments![1].offsetMs).toBe(2500);

    const alignedVtt = applySubtitleAlignment(rawVtt, result);
    expect(alignedVtt).not.toContain("osdb.link");
    expect(alignedVtt).toContain("00:00:13.957 --> 00:00:16.896");
    expect(alignedVtt).toContain("Blood. Sometimes, it sets my teeth on edge.");
    expect(alignedVtt).toContain("00:07:53.000 --> 00:07:57.500");
    expect(alignedVtt).toContain("Episode dialogue in lab.");
  });
});
