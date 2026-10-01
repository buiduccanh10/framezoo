import { describe, expect, it } from "vitest";
import { findBestOffsetFft, intervalsToSignal } from "./fft";
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
});
