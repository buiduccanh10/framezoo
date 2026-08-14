import { describe, expect, it } from "vitest";

import {
  captionIsVisible,
  getCaptionTimelineIndex,
  normalizeSubtitleToVtt,
  parseCanonicalVtt,
  shiftVttTimestamps,
  tryParseCanonicalVtt,
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

  it("normalizes WebVTT with an extended header without a format hint", () => {
    const vtt = normalizeSubtitleToVtt(`WEBVTT - generated

00:00:01.000 --> 00:00:02.500
Hello world`);

    expect(parseCanonicalVtt(vtt)).toHaveLength(1);
  });

  it("supports VTT cue settings and files without a WebVTT header", () => {
    const vtt = normalizeSubtitleToVtt(
      `00:00:01.000 --> 00:00:02.500 align:start position:10%
Hello world`,
    );

    expect(parseCanonicalVtt(vtt)).toHaveLength(1);
  });

  it("detects the payload before trusting a wrong format hint", () => {
    const srt = `1
00:00:01,000 --> 00:00:02,500
Hello world`;

    const vtt = normalizeSubtitleToVtt(srt, "vtt");

    expect(parseCanonicalVtt(vtt)).toHaveLength(1);
  });

  it("keeps an empty WebVTT document valid", () => {
    expect(parseCanonicalVtt("WEBVTT")).toEqual([]);
  });

  it("rejects malformed subtitle data instead of returning an empty VTT", () => {
    expect(() =>
      normalizeSubtitleToVtt("not a subtitle payload", "srt"),
    ).toThrow("Invalid subtitle format");
  });

  it("rejects an HTML error page as subtitle data", () => {
    expect(() =>
      normalizeSubtitleToVtt(
        "<!doctype html><html><body>upstream error</body></html>",
      ),
    ).toThrow("Invalid subtitle format");
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

  it("fails soft for malformed runtime subtitle payloads", () => {
    expect(tryParseCanonicalVtt("not a subtitle payload")).toEqual([]);
    expect(tryParseCanonicalVtt(null)).toEqual([]);
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

  it("treats cue end as exclusive for adjacent subtitles", () => {
    expect(captionIsVisible(1000, 2000, 0, 1.999)).toBe(true);
    expect(captionIsVisible(1000, 2000, 0, 2)).toBe(false);
    expect(captionIsVisible(2000, 3000, 0, 2)).toBe(true);
  });

  it("selects the next cue at an adjacent cue boundary", () => {
    const cues = parseCanonicalVtt(`WEBVTT

00:00:01.000 --> 00:00:02.000
First

00:00:02.000 --> 00:00:03.000
Second`);

    expect(getCaptionTimelineIndex(cues, 0, 2)).toBe(1);
  });
});
