import { beforeEach, describe, expect, it, vi } from "vitest";

const alignmentMocks = vi.hoisted(() => ({
  extractAudioWindow: vi.fn(),
  mwFetch: vi.fn(),
}));

vi.mock("./audioCapture", () => ({
  extractAudioWindow: alignmentMocks.extractAudioWindow,
}));
vi.mock("@/backend/helpers/fetch", () => ({
  mwFetch: alignmentMocks.mwFetch,
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
    alignmentMocks.mwFetch.mockResolvedValue({
      results: { primary: baseResult },
    });
  });

  it("always sends captured windows to the backend alignment core", async () => {
    const result = await alignSubtitlesWithCurrentStream({
      sourceUrl: "https://example.test/video.m3u8",
      startAt: 0,
      language: "en",
      subtitles: [{ track: "primary", vttData: "WEBVTT" }],
      videoDuration: 120,
    });

    expect(result.results.primary?.aligned).toBe(true);
    expect(result.results.primary?.offsetMs).toBe(-2000);
    expect(alignmentMocks.mwFetch).toHaveBeenCalledTimes(1);
  });

  it("uploads every captured window to the backend", async () => {
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
    expect(result.warningMessage).toBeUndefined();
    expect(alignmentMocks.mwFetch).toHaveBeenCalledTimes(1);
  });

  it("captures the requested number of replacement windows", async () => {
    alignmentMocks.mwFetch
      .mockResolvedValueOnce({
        results: {
          primary: {
            ...baseResult,
            aligned: false,
            confidence: 0,
            reason: "no_speech_detected",
          },
        },
        needsMoreSamples: true,
        additionalWindows: 2,
      })
      .mockResolvedValueOnce({ results: { primary: baseResult } });

    const progressEvents: Array<{
      progress: number;
      phase?: "capturing" | "analyzing";
    }> = [];
    const result = await alignSubtitlesWithCurrentStream({
      sourceUrl: "https://example.test/video.m3u8",
      startAt: 600,
      language: "en",
      subtitles: [{ track: "primary", vttData: "WEBVTT" }],
      videoDuration: 3600,
      buffered: 3600,
      onProgress: (progress, phase) => progressEvents.push({ progress, phase }),
    });

    expect(alignmentMocks.mwFetch).toHaveBeenCalledTimes(2);
    expect(
      [
        ...(alignmentMocks.mwFetch.mock.calls[0][1].body as FormData).entries(),
      ].filter(([name]) => name === "audio"),
    ).toHaveLength(6);
    expect(
      [
        ...(alignmentMocks.mwFetch.mock.calls[1][1].body as FormData).entries(),
      ].filter(([name]) => name === "audio"),
    ).toHaveLength(2);
    const getWindowStarts = (callIndex: number) => {
      const entries = [
        ...(
          alignmentMocks.mwFetch.mock.calls[callIndex][1].body as FormData
        ).entries(),
      ];
      return JSON.parse(
        entries.find(([name]) => name === "windowStartsMs")?.[1] as string,
      ) as number[];
    };
    const firstWindowStarts = getWindowStarts(0);
    const retryWindowStarts = getWindowStarts(1);
    expect(retryWindowStarts).toHaveLength(2);
    for (const retryStart of retryWindowStarts) {
      expect(
        firstWindowStarts.every(
          (firstStart) =>
            Math.abs(retryStart - firstStart) >=
            SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS * 1000,
        ),
      ).toBe(true);
    }
    expect(alignmentMocks.extractAudioWindow).toHaveBeenCalledTimes(8);
    expect(result.results.primary).toEqual(baseResult);
    const firstAnalyzingIndex = progressEvents.findIndex(
      (event) => event.phase === "analyzing",
    );
    expect(firstAnalyzingIndex).toBeGreaterThan(0);
    expect(
      progressEvents
        .slice(firstAnalyzingIndex)
        .every((event) => event.phase === "analyzing"),
    ).toBe(true);
    for (let index = 1; index < progressEvents.length; index += 1) {
      expect(progressEvents[index].progress).toBeGreaterThanOrEqual(
        progressEvents[index - 1].progress,
      );
    }
  });

  it("keeps full timeline evidence when a later playback position is synced", async () => {
    await alignSubtitlesWithCurrentStream({
      sourceUrl: "https://example.test/video.m3u8",
      startAt: 600,
      language: "en",
      subtitles: [{ track: "primary", vttData: "WEBVTT" }],
      videoDuration: 3600,
      buffered: 3600,
    });

    expect(alignmentMocks.mwFetch).toHaveBeenCalledTimes(1);
    const request = alignmentMocks.mwFetch.mock.calls[0][1];
    const entries = [...(request.body as FormData).entries()];
    const fields = new Map(
      entries.filter(([, value]) => typeof value === "string") as Array<
        [string, string]
      >,
    );

    const windowStarts = JSON.parse(fields.get("windowStartsMs")!);
    expect(windowStarts).toHaveLength(6);
    expect(windowStarts).toEqual([...windowStarts].sort((a, b) => a - b));
    expect(entries.filter(([name]) => name === "audio")).toHaveLength(6);
  });

  it("limits concurrent audio extraction while preserving all windows", async () => {
    let activeCaptures = 0;
    let maxActiveCaptures = 0;
    alignmentMocks.extractAudioWindow.mockImplementation(async () => {
      activeCaptures += 1;
      maxActiveCaptures = Math.max(maxActiveCaptures, activeCaptures);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeCaptures -= 1;
      return new Uint8Array([1, 2, 3]);
    });

    await alignSubtitlesWithCurrentStream({
      sourceUrl: "https://example.test/video.m3u8",
      startAt: 600,
      language: "en",
      subtitles: [{ track: "primary", vttData: "WEBVTT" }],
      videoDuration: 3600,
      buffered: 3600,
    });

    expect(maxActiveCaptures).toBe(3);
    expect(alignmentMocks.extractAudioWindow).toHaveBeenCalledTimes(6);
  });

  it("finishes the first torrent window before starting the remaining pool", async () => {
    let resolveFirst: (() => void) | undefined;
    let firstFinished = false;
    const starts: number[] = [];
    alignmentMocks.extractAudioWindow.mockImplementation(async (request) => {
      starts.push(request.windowIndex);
      if (request.windowIndex === 0) {
        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
        firstFinished = true;
      } else {
        expect(firstFinished).toBe(true);
      }
      return new Uint8Array([1, 2, 3]);
    });

    const pending = alignSubtitlesWithCurrentStream({
      sourceUrl: "http://127.0.0.1/torrent/file.mp4",
      startAt: 600,
      language: "en",
      subtitles: [{ track: "primary", vttData: "WEBVTT" }],
      videoDuration: 3600,
      buffered: 3600,
      isTorrent: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(starts).toEqual([0]);
    resolveFirst?.();
    await pending;
    expect(starts).toHaveLength(6);
  });

  it("keeps usable torrent windows when one seek fails", async () => {
    alignmentMocks.extractAudioWindow.mockImplementation(async (request) => {
      if (request.windowIndex === 2) {
        throw new Error("range unavailable");
      }
      return new Uint8Array([1, 2, 3]);
    });

    await alignSubtitlesWithCurrentStream({
      sourceUrl: "http://127.0.0.1/torrent/file.mp4",
      startAt: 600,
      language: "en",
      subtitles: [{ track: "primary", vttData: "WEBVTT" }],
      videoDuration: 3600,
      isTorrent: true,
    });

    const request = alignmentMocks.mwFetch.mock.calls[0][1];
    expect(
      [...(request.body as FormData).entries()].filter(
        ([name]) => name === "audio",
      ),
    ).toHaveLength(4);
  });

  it("reports monotonic progress and completes audio preparation before moving to subtitle sync", async () => {
    const progressEvents: Array<{
      progress: number;
      phase?: "capturing" | "analyzing";
    }> = [];

    await alignSubtitlesWithCurrentStream({
      sourceUrl: "https://example.test/video.m3u8",
      startAt: 600,
      language: "en",
      subtitles: [{ track: "primary", vttData: "WEBVTT" }],
      videoDuration: 3600,
      buffered: 3600,
      onProgress: (progress, phase) => {
        progressEvents.push({ progress, phase });
      },
    });

    expect(progressEvents.length).toBeGreaterThan(0);

    // Verify progress never decreases
    for (let i = 1; i < progressEvents.length; i++) {
      expect(progressEvents[i].progress).toBeGreaterThanOrEqual(
        progressEvents[i - 1].progress,
      );
    }

    // Verify all capturing phase events happen first and stay <= 0.4
    const firstAnalyzingIndex = progressEvents.findIndex(
      (e) => e.phase === "analyzing",
    );
    expect(firstAnalyzingIndex).toBeGreaterThan(0);

    const capturingEvents = progressEvents.slice(0, firstAnalyzingIndex);
    const analyzingEvents = progressEvents.slice(firstAnalyzingIndex);

    for (const e of capturingEvents) {
      expect(e.phase).toBe("capturing");
      expect(e.progress).toBeLessThanOrEqual(0.4);
    }

    // The last capturing event should reach 0.4 (100% of capturing phase)
    expect(capturingEvents[capturingEvents.length - 1].progress).toBeCloseTo(
      0.4,
      5,
    );

    // After transitioning to analyzing, phase must never go back to capturing
    for (const e of analyzingEvents) {
      expect(e.phase).toBe("analyzing");
      expect(e.progress).toBeGreaterThan(0.4);
    }

    // Final event should be 1.0 analyzing
    expect(progressEvents[progressEvents.length - 1]).toEqual({
      progress: 1,
      phase: "analyzing",
    });
  });

  it("reports monotonic progress for torrent sources without jumping phases backwards", async () => {
    const progressEvents: Array<{
      progress: number;
      phase?: "capturing" | "analyzing";
    }> = [];

    await alignSubtitlesWithCurrentStream({
      sourceUrl: "http://127.0.0.1/torrent/file.mp4",
      startAt: 600,
      language: "en",
      subtitles: [{ track: "primary", vttData: "WEBVTT" }],
      videoDuration: 3600,
      buffered: 3600,
      isTorrent: true,
      onProgress: (progress, phase) => {
        progressEvents.push({ progress, phase });
      },
    });

    // Verify progress never decreases
    for (let i = 1; i < progressEvents.length; i++) {
      expect(progressEvents[i].progress).toBeGreaterThanOrEqual(
        progressEvents[i - 1].progress,
      );
    }

    // Phase transition must only occur once: capturing -> analyzing
    let seenAnalyzing = false;
    for (const e of progressEvents) {
      if (e.phase === "analyzing") {
        seenAnalyzing = true;
      }
      if (seenAnalyzing) {
        expect(e.phase).toBe("analyzing");
      } else {
        expect(e.phase).toBe("capturing");
      }
    }

    expect(progressEvents[progressEvents.length - 1]).toEqual({
      progress: 1,
      phase: "analyzing",
    });
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

  it("preserves exact fallback starts with empty VTT and nudges fallbacks toward dialogue-dense cues", () => {
    const emptyPlan = buildAlignmentWindowPlan(600, 3600, 900, {
      subtitleVtts: ["WEBVTT"],
    });
    expect(emptyPlan.map((w) => w.startAt)).toEqual([
      600, 840, 531, 1239, 1947, 2655,
    ]);

    // Anchor 1239s..1299s only has SDH music/effects, while 1329s..1389s (+90s) has 4 dialogue cues.
    const richVtt = `WEBVTT

00:20:45.000 --> 00:20:48.000
[DRAMATIC MUSIC]

00:22:10.000 --> 00:22:12.000
Line one right around 1330s.

00:22:18.000 --> 00:22:20.000
Line two right around 1338s.

00:22:26.000 --> 00:22:28.000
Line three right around 1346s.

00:22:34.000 --> 00:22:36.000
Line four right around 1354s.`;

    const nudgedPlan = buildAlignmentWindowPlan(600, 3600, 900, {
      subtitleVtts: [richVtt],
    });
    const nudgedStarts = nudgedPlan.map((w) => w.startAt);
    expect(nudgedStarts).not.toContain(1239);
    expect(nudgedStarts.some((s) => s >= 1295 && s <= 1350)).toBe(true);
  });

  it("applies rateRatio alongside offsetMs in applySubtitleAlignment", () => {
    const rawVtt = `WEBVTT

00:01:40.000 --> 00:01:42.000
Dialogue at 100s.`;
    const aligned = applySubtitleAlignment(rawVtt, {
      ...baseResult,
      offsetMs: 500,
      rateRatio: 1.01,
    });
    // 100_000 * 1.01 + 500 = 101_500ms = 00:01:41.500
    expect(aligned).toContain("00:01:41.500 --> 00:01:43.520");
  });

  it("emits live window probe states and preparing/analyzing phases via onTelemetry", async () => {
    const telemetryEvents: Array<{
      phase: string;
      stage?: string;
      statuses: string[];
    }> = [];

    await alignSubtitlesWithCurrentStream({
      sourceUrl: "https://example.test/video.m3u8",
      startAt: 600,
      language: "en",
      subtitles: [{ track: "primary", vttData: "WEBVTT" }],
      videoDuration: 3600,
      buffered: 3600,
      onTelemetry: (telemetry) => {
        telemetryEvents.push({
          phase: telemetry.phase,
          stage: telemetry.stage,
          statuses: telemetry.windows.map((w) => w.status),
        });
      },
    });

    expect(telemetryEvents[0]?.phase).toBe("capturing");
    expect(telemetryEvents[0]?.statuses.every((s) => s === "queued")).toBe(
      true,
    );
    expect(telemetryEvents.some((e) => e.statuses.includes("capturing"))).toBe(
      true,
    );
    expect(
      telemetryEvents.some(
        (e) => e.phase === "preparing" && e.stage === "upload",
      ),
    ).toBe(true);
    expect(
      telemetryEvents.some((e) => e.phase === "analyzing" && e.stage === "vad"),
    ).toBe(true);
    expect(telemetryEvents.at(-1)?.phase).toBe("analyzing");
    expect(telemetryEvents.at(-1)?.stage).toBe("consensus");
    expect(
      telemetryEvents.at(-1)?.statuses.every((s) => s === "captured"),
    ).toBe(true);
  });
});
