import { describe, expect, it } from "vitest";

import { removeVttAds } from "./captions";
import { alignLocalBatch, alignLocalTrack } from "./localAlignment";

describe("local Moonshine alignment", () => {
  it("finds the same offset as the server alignment fixtures", () => {
    const vtt = `WEBVTT

00:00:10.000 --> 00:00:13.000
Hello

00:00:20.000 --> 00:00:23.000
Again`;

    const result = alignLocalTrack(
      vtt,
      [
        [0, 3_000],
        [10_000, 13_000],
      ],
      0,
      30_000,
    );

    expect(result.aligned).toBe(true);
    expect(result.offsetMs).toBeCloseTo(-10_000, -2);
    expect(result.confidence).toBeGreaterThanOrEqual(60);
  });

  it("keeps aligned false when no speech is detected", () => {
    const result = alignLocalTrack(
      "WEBVTT\n\n00:00:05.000 --> 00:00:09.000\nHello",
      [],
      0,
      10_000,
    );

    expect(result).toMatchObject({
      aligned: false,
      offsetMs: 0,
      confidence: 0,
      reason: "no_speech_detected",
    });
  });

  it("returns both tracks without calling the server", () => {
    const result = alignLocalBatch(
      [
        {
          track: "primary",
          vttData: "WEBVTT\n\n00:00:10.000 --> 00:00:13.000\nHello",
        },
        {
          track: "secondary",
          vttData: "WEBVTT\n\n00:00:12.000 --> 00:00:15.000\nHello",
        },
      ],
      [
        [0, 3_000],
        [10_000, 13_000],
      ],
      0,
      30_000,
    );

    expect(result.results.primary).toBeDefined();
    expect(result.results.secondary).toBeDefined();
    expect(result.results.primary?.speechIntervals).toEqual([
      { startMs: 0, endMs: 3_000 },
      { startMs: 10_000, endMs: 13_000 },
    ]);
  });

  it("accepts a large offset inferred from the first cue", () => {
    const result = alignLocalTrack(
      `WEBVTT

00:02:00.000 --> 00:02:04.000
Hello

00:02:10.000 --> 00:02:14.000
World`,
      [
        [17_000, 21_000],
        [27_000, 31_000],
        [37_000, 41_000],
      ],
      17_000,
      47_000,
    );

    expect(result.aligned).toBe(true);
    expect(result.offsetMs).toBeCloseTo(-103_000, -2);
  });

  it("keeps relative-offset hints parity when the first cues are outside the window", () => {
    const result = alignLocalBatch(
      [
        {
          track: "secondary",
          vttData: `WEBVTT

00:02:00.000 --> 00:02:04.000
Hello

00:02:10.000 --> 00:02:14.000
World`,
        },
        {
          track: "primary",
          vttData: `WEBVTT

00:00:17.000 --> 00:00:21.000
Hello

00:00:27.000 --> 00:00:31.000
World`,
        },
      ],
      [
        [17_000, 21_000],
        [27_000, 31_000],
        [37_000, 41_000],
      ],
      17_000,
      47_000,
    );

    expect(result.results.primary?.aligned).toBe(true);
    expect(result.results.secondary?.aligned).toBe(true);
    expect(result.results.secondary?.offsetMs).toBeCloseTo(-103_000, -2);
  });

  it("ignores subtitle credit cues while estimating relative offsets", () => {
    const result = alignLocalBatch(
      [
        {
          track: "primary",
          vttData: `WEBVTT

00:00:01.000 --> 00:00:04.000
Subtitle by Subscene

00:00:17.000 --> 00:00:21.000
Hello

00:00:27.000 --> 00:00:31.000
World

00:00:37.000 --> 00:00:41.000
Again`,
        },
        {
          track: "secondary",
          vttData: `WEBVTT

00:00:02.000 --> 00:00:05.000
Dịch bởi PhimMoi

00:02:00.000 --> 00:02:04.000
Hello

00:02:10.000 --> 00:02:14.000
World

00:02:20.000 --> 00:02:24.000
Again`,
        },
      ],
      [
        [17_000, 21_000],
        [27_000, 31_000],
        [37_000, 41_000],
      ],
      17_000,
      47_000,
    );

    expect(result.results.secondary?.aligned).toBe(true);
    expect(result.results.secondary?.offsetMs).toBeCloseTo(-103_000, -2);
  });

  it("aligns both tracks when the secondary release starts far later", () => {
    const result = alignLocalBatch(
      [
        {
          track: "primary",
          vttData: `WEBVTT

00:00:17.000 --> 00:00:21.000
Hello

00:00:27.000 --> 00:00:31.000
World`,
        },
        {
          track: "secondary",
          vttData: `WEBVTT

00:02:00.000 --> 00:02:04.000
Hello

00:02:10.000 --> 00:02:14.000
World`,
        },
      ],
      [
        [17_000, 21_000],
        [27_000, 31_000],
      ],
      17_000,
      47_000,
    );

    expect(result.results.primary?.aligned).toBe(true);
    expect(result.results.primary?.offsetMs).toBeCloseTo(0, -2);
    expect(result.results.secondary?.aligned).toBe(true);
    expect(result.results.secondary?.offsetMs).toBeCloseTo(-103_000, -2);
  });

  it("keeps the valid primary result when the secondary VTT is invalid", () => {
    const result = alignLocalBatch(
      [
        {
          track: "primary",
          vttData: `WEBVTT

00:00:00.000 --> 00:00:04.000
Hello`,
        },
        {
          track: "secondary",
          vttData: "WEBVTT\n\nnot a timing line",
        },
      ],
      [[0, 4_000]],
      0,
      10_000,
    );

    expect(result.results.primary?.aligned).toBe(true);
    expect(result.results.secondary).toMatchObject({
      aligned: false,
      offsetMs: 0,
      reason: "invalid_subtitle",
    });
  });

  it("matches the backend relative-offset fixture with a leading credit", () => {
    const result = alignLocalBatch(
      [
        {
          track: "primary",
          vttData: `WEBVTT

00:00:01.000 --> 00:00:04.000
Subtitles by Subscene

00:00:17.000 --> 00:00:21.000
Hello

00:00:27.000 --> 00:00:31.000
World

00:00:37.000 --> 00:00:41.000
Again`,
        },
        {
          track: "secondary",
          vttData: `WEBVTT

00:00:02.000 --> 00:00:05.000
Subtitles by Example

00:02:00.000 --> 00:02:04.000
Hello

00:02:10.000 --> 00:02:14.000
World

00:02:20.000 --> 00:02:24.000
Again`,
        },
      ],
      [
        [17_000, 21_000],
        [27_000, 31_000],
        [37_000, 41_000],
      ],
      17_000,
      47_000,
    );

    expect(result.results.primary?.aligned).toBe(true);
    expect(result.results.secondary?.aligned).toBe(true);
    expect(result.results.secondary?.offsetMs).toBeCloseTo(-103_000, -2);
  });

  it("keeps the release offset when a non-dialogue translation credit is present", () => {
    const result = alignLocalBatch(
      [
        {
          track: "primary",
          vttData: `WEBVTT

00:00:17.000 --> 00:00:21.000
Hello

00:00:27.000 --> 00:00:31.000
World`,
        },
        {
          track: "secondary",
          vttData: removeVttAds(`WEBVTT

00:00:02.000 --> 00:00:05.000
Translated by Example

00:02:00.000 --> 00:02:04.000
Hello

00:02:10.000 --> 00:02:14.000
World`),
        },
      ],
      [
        [17_000, 21_000],
        [27_000, 31_000],
      ],
      17_000,
      47_000,
    );

    expect(result.results.primary?.aligned).toBe(true);
    expect(result.results.secondary?.aligned).toBe(true);
    expect(result.results.secondary?.offsetMs).toBeCloseTo(-103_000, -2);
  });

  it("matches the backend release-offset fixture with an ad-only intro", () => {
    const result = alignLocalBatch(
      [
        {
          track: "primary",
          vttData: `WEBVTT

00:00:11.000 --> 00:00:15.000
Blood. Sometimes, it sets my teeth on edge.

00:00:15.000 --> 00:00:19.000
Other times, it helps me control the chaos.`,
        },
        {
          track: "secondary",
          vttData: `WEBVTT

00:00:08.000 --> 00:00:12.000
Support us and become VIP member to remove all ads from www.OpenSubtitles.org

00:01:57.000 --> 00:02:01.000
Blood. Sometimes, it sets my teeth on edge.

00:02:01.000 --> 00:02:05.000
Other times, it helps me control the chaos.`,
        },
      ],
      [
        [11_000, 15_000],
        [15_000, 19_000],
      ],
      11_000,
      41_000,
    );

    expect(result.results.primary?.aligned).toBe(true);
    expect(result.results.secondary?.aligned).toBe(true);
    expect(result.results.secondary?.offsetMs).toBeCloseTo(-106_000, -2);
  });
});
