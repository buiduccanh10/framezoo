import { describe, expect, it } from "vitest";

import {
  getMonotonicPlaybackTime,
  getProjectedPlaybackTime,
} from "./usePlaybackClock";

describe("playback clock", () => {
  it("keeps the visual clock from moving backward on a stale IPC sample", () => {
    expect(getMonotonicPlaybackTime(10.2, 10.9, 10.9, 120)).toBe(10.9);
  });

  it("accepts a newer authoritative sample", () => {
    expect(getMonotonicPlaybackTime(11.2, 10.9, 10.9, 120)).toBe(11.2);
  });

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
});
