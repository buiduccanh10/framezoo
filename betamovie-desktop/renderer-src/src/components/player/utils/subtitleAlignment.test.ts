import { describe, expect, it } from "vitest";

import { parseCanonicalVtt } from "./captions";
import {
  type SubtitleAlignmentResponse,
  applySubtitleAlignment,
} from "./subtitleAlignment";

const baseResult: SubtitleAlignmentResponse = {
  aligned: true,
  offsetMs: -2000,
  confidence: 90,
  speechIntervals: [],
  cleanedVtt: "",
  reason: null,
};

describe("subtitle alignment", () => {
  it("applies a negative offset when the downloaded subtitle is late", () => {
    const vtt = `WEBVTT

00:00:05.000 --> 00:00:07.000
Hello`;

    const aligned = applySubtitleAlignment(vtt, baseResult);
    const [cue] = parseCanonicalVtt(aligned);

    expect([cue.start, cue.end]).toEqual([3000, 5000]);
  });

  it("uses cleaned VTT without changing the alignment sign", () => {
    const result = {
      ...baseResult,
      cleanedVtt: `WEBVTT

00:00:05.000 --> 00:00:07.000
Hello`,
    };

    const aligned = applySubtitleAlignment("WEBVTT", result);
    expect(aligned).toContain("00:00:03.000 --> 00:00:05.000");
  });
});
