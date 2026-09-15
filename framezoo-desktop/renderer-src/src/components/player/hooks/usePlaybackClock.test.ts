import { describe, expect, it } from "vitest";

import {
  MAX_EXTRAPOLATION_SECONDS,
  getMonotonicPlaybackTime,
  getProjectedPlaybackTime,
  shouldSnapPlaybackClock,
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
      getProjectedPlaybackTime({ time: 10, timestamp: 1_000 }, 25_000, 1, 120),
    ).toBe(10 + MAX_EXTRAPOLATION_SECONDS);
  });

  it("returns anchor time directly when timestamp is inactive / zero (e.g. during buffering / isLoading)", () => {
    expect(
      getProjectedPlaybackTime({ time: 10, timestamp: 0 }, 1_500, 1, 120),
    ).toBe(10);
    expect(
      getProjectedPlaybackTime({ time: 25.5, timestamp: 0 }, 50_000, 1, 120),
    ).toBe(25.5);
  });

  describe("getMonotonicPlaybackTime", () => {
    it("keeps current clock time when an authoritative sample is slightly behind (IPC latency)", () => {
      // Current extrapolated clock reached 12.02, but delayed IPC sample arrives with 11.98
      expect(getMonotonicPlaybackTime(11.98, 12.02, false, 120)).toBe(12.02);
    });

    it("advances clock when an authoritative sample is ahead", () => {
      // Authoritative sample 12.10 is ahead of extrapolated 12.02
      expect(getMonotonicPlaybackTime(12.1, 12.02, false, 120)).toBe(12.1);
    });

    it("immediately snaps on an intentional backward seek (>3.0s jump backward)", () => {
      // User jumped back to 5.0 from 12.02
      expect(getMonotonicPlaybackTime(5.0, 12.02, false, 120)).toBe(5.0);
    });

    it("immediately snaps on seek even for small backward adjustments", () => {
      // User scrubbed back to 11.7 from 12.02 with isSeeking=true
      expect(getMonotonicPlaybackTime(11.7, 12.02, true, 120)).toBe(11.7);
    });

    it("immediately snaps on an intentional forward jump (>3.0s jump forward)", () => {
      // User jumped forward to 45.0 from 12.02
      expect(getMonotonicPlaybackTime(45.0, 12.02, false, 120)).toBe(45.0);
    });

    it("maintains current time if sample is within jitter tolerance during continuous playback", () => {
      expect(getMonotonicPlaybackTime(11.98, 12.02, false, 120)).toBe(12.02);
    });

    it("clamps authoritative time within duration bounds", () => {
      expect(getMonotonicPlaybackTime(130.0, 10.0, false, 120)).toBe(120);
      expect(getMonotonicPlaybackTime(-5.0, 10.0, false, 120)).toBe(0);
    });
  });

  describe("shouldSnapPlaybackClock", () => {
    it("ignores a large stale backward sample during continuous playback", () => {
      expect(shouldSnapPlaybackClock(5, 12, false, false, false)).toBe(false);
    });

    it("does not snap when seeking starts before the target sample arrives", () => {
      expect(shouldSnapPlaybackClock(12, 12, true, true, false)).toBe(false);
    });

    it("snaps to a small backward seek once the target sample changes", () => {
      expect(shouldSnapPlaybackClock(11.7, 12, false, true, false)).toBe(true);
    });

    it("snaps when the media/source identity changes", () => {
      expect(shouldSnapPlaybackClock(0, 12, false, false, true)).toBe(true);
    });

    it("snaps a forward discontinuity without waiting for a seek flag", () => {
      expect(shouldSnapPlaybackClock(45, 12, false, false, false)).toBe(true);
    });
  });
});
