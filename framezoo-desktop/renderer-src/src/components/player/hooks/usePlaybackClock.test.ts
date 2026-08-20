import { describe, expect, it } from "vitest";

import {
  MAX_EXTRAPOLATION_SECONDS,
  getProjectedPlaybackTime,
} from "./usePlaybackClock";

describe("playback clock", () => {
  it("projects elapsed playback from the latest accepted anchor", () => {
    expect(
      getProjectedPlaybackTime({ time: 10, timestamp: 1_000 }, 1_500, 1, 120),
    ).toBe(10.5);
  });

  it("clamps projected playback to the media duration", () => {
    expect(
      getProjectedPlaybackTime(
        { time: 119.8, timestamp: 1_000 },
        1_500,
        1,
        120,
      ),
    ).toBe(120);
  });

  it("caps extrapolation duration to MAX_EXTRAPOLATION_SECONDS to prevent drift on stalls", () => {
    expect(
      getProjectedPlaybackTime({ time: 10, timestamp: 1_000 }, 5_000, 1, 120),
    ).toBe(10 + MAX_EXTRAPOLATION_SECONDS);
  });

  it("returns anchor time directly when timestamp is inactive / zero", () => {
    expect(
      getProjectedPlaybackTime({ time: 10, timestamp: 0 }, 1_500, 1, 120),
    ).toBe(10);
  });
});
