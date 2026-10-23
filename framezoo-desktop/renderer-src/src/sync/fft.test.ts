import { describe, expect, it } from "vitest";

import {
  evaluateSpeechWindowLocal,
  filterAlignmentCues,
  parseVttCues,
  selectAlignmentConsensusLocal,
} from "./aligner";
import { findBestOffsetFft } from "./fft";
import { computePiecewiseSegments } from "./split";

describe("Local FFT Subtitle Alignment", () => {
  it("detects positive offset accurately", () => {
    // Speech at 10s-14s and 20s-25s
    const speech: Array<[number, number]> = [
      [10_000, 14_000],
      [20_000, 25_000],
    ];
    // Subtitles are shifted earlier by 3.5s (at 6.5s and 16.5s)
    const subs: Array<[number, number]> = [
      [6_500, 10_500],
      [16_500, 21_500],
    ];

    const result = findBestOffsetFft(speech, subs, 0, 60_000, 45_000);
    expect(Math.abs(result.offsetMs - 3500)).toBeLessThanOrEqual(25);
    expect(result.confidence).toBeGreaterThanOrEqual(90);
    expect(result.ratio).toBe(1.0);
  });

  it("detects negative offset accurately", () => {
    const speech: Array<[number, number]> = [[10_000, 15_000]];
    // Subtitles shifted later by 4.0s (at 14s)
    const subs: Array<[number, number]> = [[14_000, 19_000]];

    const result = findBestOffsetFft(speech, subs, 0, 60_000, 45_000);
    expect(Math.abs(result.offsetMs - -4000)).toBeLessThanOrEqual(25);
    expect(result.confidence).toBeGreaterThanOrEqual(90);
  });

  it("detects framerate ratio difference", () => {
    const ratio = 25.0 / 23.976;
    const speech: Array<[number, number]> = [
      [10_000, 15_000],
      [30_000, 35_000],
      [50_000, 55_000],
    ];
    const subs: Array<[number, number]> = speech.map(([s, e]) => [
      Math.round(s / ratio),
      Math.round(e / ratio),
    ]);

    const result = findBestOffsetFft(speech, subs, 0, 60_000, 45_000, true);
    expect(Math.abs(result.ratio - ratio)).toBeLessThan(0.02);
    expect(Math.abs(result.offsetMs)).toBeLessThanOrEqual(50);
  });

  it("computes piecewise segments on non-linear drift", () => {
    const windows = [
      {
        startAt: 0,
        result: { aligned: true, offsetMs: 2000, confidence: 95 },
      },
      {
        startAt: 60,
        result: { aligned: true, offsetMs: 2050, confidence: 92 },
      },
      {
        startAt: 300,
        result: { aligned: true, offsetMs: 15000, confidence: 93 },
      },
      {
        startAt: 360,
        result: { aligned: true, offsetMs: 15020, confidence: 90 },
      },
    ];

    const segments = computePiecewiseSegments(windows, 2025);
    expect(segments.length).toBe(2);
    expect(Math.abs(segments[0]!.offsetMs - 2025)).toBeLessThanOrEqual(50);
    expect(Math.abs(segments[1]!.offsetMs - 15010)).toBeLessThanOrEqual(50);
  });

  it("rejects dense distant dialogue false positive via local window energy normalization", () => {
    const speech: Array<[number, number]> = [
      [10_000, 12_000],
      [20_000, 22_000],
    ];
    const subs: Array<[number, number]> = [
      [10_000, 12_000],
      [20_000, 22_000],
    ];
    for (let t = 65_000; t < 120_000; t += 2_000) {
      subs.push([t, t + 1_900]);
    }

    const result = findBestOffsetFft(speech, subs, 0, 60_000, 120_000, false);
    expect(Math.abs(result.offsetMs)).toBeLessThanOrEqual(50);
    expect(result.confidence).toBeGreaterThanOrEqual(90);
  });

  it("filters SDH non-speech cues and aligns local speech window accurately", () => {
    const vtt = `WEBVTT

00:00:02.000 --> 00:00:05.000
[Dramatic music]

00:00:06.000 --> 00:00:09.000
♪ Singing in the rain ♪

00:00:15.000 --> 00:00:18.000
Hello there, general.

00:00:25.000 --> 00:00:28.000
We have been waiting for you.
`;
    const cues = filterAlignmentCues(parseVttCues(vtt));
    expect(cues).toHaveLength(2);
    expect(cues[0]!.startMs).toBe(15_000);

    const winRes = evaluateSpeechWindowLocal({
      cues,
      speechIntervals: [
        [12_500, 15_500],
        [22_500, 25_500],
      ],
      audioStartMs: 0,
      audioEndMs: 60_000,
    });
    expect(winRes.aligned).toBe(true);
    expect(Math.abs(winRes.offsetMs - -2500)).toBeLessThanOrEqual(100);
  });

  it("picks consensus cluster over single-window outlier in local aligner", () => {
    const consensus = selectAlignmentConsensusLocal(
      [
        {
          startAt: 60,
          result: {
            aligned: true,
            offsetMs: -2000,
            confidence: 80,
            speechIntervals: [{ startMs: 60_000, endMs: 64_000 }],
            reason: null,
          },
        },
        {
          startAt: 300,
          result: {
            aligned: true,
            offsetMs: -2200,
            confidence: 78,
            speechIntervals: [{ startMs: 300_000, endMs: 304_000 }],
            reason: null,
          },
        },
        {
          startAt: 600,
          result: {
            aligned: true,
            offsetMs: 42_000,
            confidence: 96,
            speechIntervals: [{ startMs: 600_000, endMs: 604_000 }],
            reason: null,
          },
        },
      ],
      [{ startMs: 60_000, endMs: 64_000 }],
    );

    expect(consensus.aligned).toBe(true);
    expect(consensus.offsetMs).toBe(-2100);
  });
});
