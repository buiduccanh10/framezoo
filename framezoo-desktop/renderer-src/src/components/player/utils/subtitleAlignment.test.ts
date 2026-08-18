import { beforeEach, describe, expect, it, vi } from "vitest";

const alignmentMocks = vi.hoisted(() => ({
  extractAudioWindow: vi.fn(),
  mwFetch: vi.fn(),
  ensureMoonshineModel: vi.fn(),
  transcribeMoonshine: vi.fn(),
  decodeMoonshineWav: vi.fn(),
  disableMoonshineForSession: vi.fn(),
}));

vi.mock("./audioCapture", () => ({
  extractAudioWindow: alignmentMocks.extractAudioWindow,
}));
vi.mock("@/backend/helpers/fetch", () => ({
  mwFetch: alignmentMocks.mwFetch,
}));
vi.mock("@/moonshine/runtime", () => ({
  MoonshineLanguageUnavailableError: class extends Error {},
  MoonshineModelCancelledError: class extends Error {},
  decodeMoonshineWav: alignmentMocks.decodeMoonshineWav,
  disableMoonshineForSession: alignmentMocks.disableMoonshineForSession,
  ensureMoonshineModel: alignmentMocks.ensureMoonshineModel,
  transcribeMoonshine: alignmentMocks.transcribeMoonshine,
}));
vi.mock("@/setup/config", () => ({
  conf: () => ({ BACKEND_URL: "http://backend" }),
}));

import { parseCanonicalVtt } from "./captions";
import {
  SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS,
  type SubtitleAlignmentResponse,
  alignSubtitlesWithCurrentStream,
  applySubtitleAlignment,
  areSubtitleAlignmentResultsApplicable,
  buildAlignmentWindowPlan,
  getSubtitleAlignmentBaseVtt,
  getSubtitleAlignmentInputVtt,
  getSubtitleAlignmentWindowDuration,
} from "./subtitleAlignment";

const baseResult: SubtitleAlignmentResponse = {
  aligned: true,
  offsetMs: -2000,
  confidence: 90,
  speechIntervals: [{ startMs: 0, endMs: 1000 }],
  reason: null,
};

describe("subtitle alignment client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    alignmentMocks.extractAudioWindow.mockResolvedValue(
      new Uint8Array([1, 2, 3]),
    );
    alignmentMocks.decodeMoonshineWav.mockReturnValue({ durationMs: 60_000 });
    alignmentMocks.ensureMoonshineModel.mockResolvedValue({
      language: "en",
      architecture: "tiny",
      files: [],
    });
    alignmentMocks.transcribeMoonshine.mockResolvedValue([
      { startMs: 12_000, endMs: 18_000 },
    ]);
    alignmentMocks.mwFetch.mockResolvedValue({
      results: { primary: baseResult },
    });
  });

  it("sends local absolute speech intervals without uploading audio", async () => {
    await alignSubtitlesWithCurrentStream({
      sourceUrl: "https://example.test/video.m3u8",
      startAt: 0,
      language: "en",
      subtitles: [{ track: "primary", vttData: "WEBVTT" }],
      videoDuration: 120,
    });

    const request = alignmentMocks.mwFetch.mock.calls[0][1];
    const entries = [...(request.body as FormData).entries()];
    const fields = new Map(
      entries.filter(([, value]) => typeof value === "string") as Array<
        [string, string]
      >,
    );

    expect(entries.filter(([name]) => name === "audio")).toHaveLength(0);
    expect(JSON.parse(fields.get("speechIntervals")!)).toEqual([
      [{ startMs: 12_000, endMs: 18_000 }],
      [{ startMs: 72_000, endMs: 78_000 }],
    ]);
    expect(JSON.parse(fields.get("windowStartsMs")!)).toEqual([0, 60_000]);
    expect(JSON.parse(fields.get("windowDurationsMs")!)).toEqual([
      60_000, 60_000,
    ]);
  });

  it("falls back to uploading every captured window when local inference fails", async () => {
    alignmentMocks.ensureMoonshineModel.mockRejectedValue(
      new Error("local model unavailable"),
    );

    const result = await alignSubtitlesWithCurrentStream({
      sourceUrl: "https://example.test/video.m3u8",
      startAt: 0,
      language: "en",
      subtitles: [{ track: "primary", vttData: "WEBVTT" }],
      videoDuration: 120,
    });

    const request = alignmentMocks.mwFetch.mock.calls[0][1];
    const entries = [...(request.body as FormData).entries()];

    expect(entries.filter(([name]) => name === "audio")).toHaveLength(2);
    expect(entries.some(([name]) => name === "speechIntervals")).toBe(false);
    expect(result.warningMessage).toContain("server fallback");
    expect(alignmentMocks.transcribeMoonshine).not.toHaveBeenCalled();
  });

  it("plans independent current, buffered, and fallback windows", () => {
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

  it("caps duplicate or clamped windows", () => {
    const plan = buildAlignmentWindowPlan(0, 120);

    expect(plan.length).toBeLessThanOrEqual(6);
    expect(new Set(plan.map((window) => window.startAt)).size).toBe(
      plan.length,
    );
    expect(plan[0]).toEqual({ startAt: 0, priority: "nearby" });
  });

  it("uses half-file windows for short videos", () => {
    expect(getSubtitleAlignmentWindowDuration(90)).toBe(45);
    expect(buildAlignmentWindowPlan(0, 90).slice(0, 2)).toEqual([
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
    expect(buildAlignmentWindowPlan(0, undefined).length).toBeGreaterThan(1);
  });

  it("does not create duplicate windows for very short videos", () => {
    for (const duration of [0.5, 1.5]) {
      const plan = buildAlignmentWindowPlan(0, duration);
      expect(plan).toHaveLength(1);
      expect(new Set(plan.map((window) => window.startAt)).size).toBe(1);
    }
  });

  it("applies a negative server offset", () => {
    const vtt = `WEBVTT

00:00:05.000 --> 00:00:07.000
Hello`;

    const aligned = applySubtitleAlignment(vtt, baseResult);
    const [cue] = parseCanonicalVtt(aligned);

    expect([cue.start, cue.end]).toEqual([3000, 5000]);
  });

  it("does not add the server offset twice after a previous apply", () => {
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

  it("uses the canonical source timeline for translated captions", () => {
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

  it("applies piecewise segments returned by the server", () => {
    const rawVtt = `WEBVTT

00:01:57.957 --> 00:02:00.896
Blood.

00:07:50.500 --> 00:07:55.000
Episode dialogue.`;
    const result: SubtitleAlignmentResponse = {
      ...baseResult,
      offsetMs: 2500,
      segments: [
        { startMs: 0, endMs: 180000, offsetMs: -104000 },
        {
          startMs: 180000,
          endMs: Number.MAX_SAFE_INTEGER,
          offsetMs: 2500,
        },
      ],
    };

    const aligned = applySubtitleAlignment(rawVtt, result);
    expect(aligned).toContain("00:00:13.957 --> 00:00:16.896");
    expect(aligned).toContain("00:07:53.000 --> 00:07:57.500");
  });

  it("requires all target tracks to match the current caption state", () => {
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

  it("rejects a stale server result", () => {
    expect(
      areSubtitleAlignmentResultsApplicable([
        {
          result: baseResult,
          expectedCaptionId: "primary",
          currentCaptionId: "other",
        },
      ]),
    ).toBe(false);
  });
});
