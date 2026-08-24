import { describe, expect, it } from "vitest";

import {
  getNextEpisodeVisibility,
  getSkipSegmentVisibility,
  isSegmentEndingAtVideoEnd,
} from "./controlVisibility";

const intro = {
  type: "intro" as const,
  start_ms: 20_000,
  end_ms: 40_000,
  confidence: 1,
  submission_count: 1,
};

describe("player control visibility", () => {
  it("keeps skip visible for the first ten seconds, then requires controls", () => {
    expect(getSkipSegmentVisibility(20, intro, 120)).toBe("always");
    expect(getSkipSegmentVisibility(30.1, intro, 120)).toBe("hover");
    expect(getSkipSegmentVisibility(40, intro, 120)).toBe("hover");
    expect(getSkipSegmentVisibility(40.1, intro, 120)).toBe("none");
  });

  it("uses the main-player next episode thresholds", () => {
    expect(getNextEpisodeVisibility(80, 120)).toBe("none");
    expect(getNextEpisodeVisibility(940, 1000)).toBe("hover");
    expect(getNextEpisodeVisibility(971, 1000)).toBe("always");
  });

  it("only treats a segment ending at the video end as an ending segment", () => {
    expect(isSegmentEndingAtVideoEnd({ ...intro, end_ms: 120_000 }, 120)).toBe(
      true,
    );
    expect(isSegmentEndingAtVideoEnd(intro, 120)).toBe(false);
  });
});
