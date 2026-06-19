import { describe, expect, it } from "vitest";

import { normalizeSubtitleToVtt, parseCanonicalVtt } from "./captions";

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
});
