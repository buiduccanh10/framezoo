import { describe, expect, it } from "vitest";

import {
  captionIsVisible,
  getCaptionTimelineIndex,
  normalizeSubtitleToVtt,
  parseCanonicalVtt,
  shiftVttPiecewiseTimestamps,
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

  it("shifts cues piecewise according to defined timeline segments", () => {
    const vtt = `WEBVTT

00:00:06.000 --> 00:00:12.000
Ad to be removed

00:01:57.957 --> 00:02:00.896
Intro dialogue

00:07:50.000 --> 00:07:55.000
Main movie dialogue`;

    const shifted = parseCanonicalVtt(
      shiftVttPiecewiseTimestamps(
        vtt,
        [
          { startMs: 0, endMs: 180_000, offsetMs: -104_000 },
          { startMs: 180_000, endMs: 600_000, offsetMs: 2_500 },
        ],
        0,
      ),
    );

    expect(shifted).toHaveLength(2);
    expect(shifted[0].content).toBe("Intro dialogue");
    expect(shifted[0].start).toBe(13957);
    expect(shifted[1].content).toBe("Main movie dialogue");
    expect(shifted[1].start).toBe(472500);
  });

  it("identifies and strips promotional ad cues from VTT text and canonical cues", () => {
    const rawVtt = `WEBVTT

00:00:06.000 --> 00:00:12.000
Watch Online Movies and Series for FREE www.osdb.link/lm

00:00:13.000 --> 00:00:16.000
Support us and become VIP member to remove all ads from www.OpenSubtitles.org

00:00:17.000 --> 00:00:20.000
Phụ đề được biên dịch bởi PhimMoi

00:00:25.000 --> 00:00:30.000
Hello this is actual movie dialogue`;

    const cues = parseCanonicalVtt(rawVtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].content).toBe("Hello this is actual movie dialogue");
  });
});
