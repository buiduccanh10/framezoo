import { describe, expect, it } from "vitest";

import {
  normalizeSubtitleToVtt,
  parseCanonicalVtt,
  shiftVttTimestamps,
} from "./captions";

describe("canonical subtitle VTT helpers", () => {
  it("normalizes SRT subtitle text into valid WebVTT", () => {
    const srt = `1
00:00:01,000 --> 00:00:02,500
Hello world`;

    const vtt = normalizeSubtitleToVtt(srt);

    expect(vtt.startsWith("WEBVTT")).toBe(true);
    const cues = parseCanonicalVtt(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].content).toBe("Hello world");
  });

  it("deduplicates canonical VTT cues during parse", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.500
Hello world

00:00:01.000 --> 00:00:02.500
Hello world

00:00:03.000 --> 00:00:04.000
Second line`;

    const cues = parseCanonicalVtt(vtt);

    expect(cues).toHaveLength(2);
    expect(cues.map((cue) => cue.content)).toEqual([
      "Hello world",
      "Second line",
    ]);
  });

  it("shifts native VTT cues by subtitle delay", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.500
Hello world

00:00:03.000 --> 00:00:04.000
Second line`;

    const shiftedVtt = shiftVttTimestamps(vtt, 1.25);
    const shifted = parseCanonicalVtt(shiftedVtt);

    expect(shifted.map((cue) => [cue.start, cue.end])).toEqual([
      [2250, 3750],
      [4250, 5250],
    ]);
    expect(shiftedVtt).toContain("00:00:02.250 --> 00:00:03.750");
  });

  it("clamps shifted cues at zero and removes cues fully before zero", () => {
    const vtt = `WEBVTT

00:00:00.200 --> 00:00:00.800
Removed

00:00:01.500 --> 00:00:02.000
Clamped`;

    const shifted = parseCanonicalVtt(shiftVttTimestamps(vtt, -1));

    expect(shifted.map((cue) => [cue.start, cue.end, cue.content])).toEqual([
      [500, 1000, "Clamped"],
    ]);
  });
});
