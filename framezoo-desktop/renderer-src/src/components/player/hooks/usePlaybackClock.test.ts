import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_EXTRAPOLATION_SECONDS,
  SUBTITLE_PLAYBACK_CLOCK_TICK_MS,
  VISUAL_PLAYBACK_CLOCK_TICK_MS,
  getMonotonicPlaybackTime,
  getProjectedPlaybackTime,
  useSmoothPlaybackClock,
} from "./usePlaybackClock";

type ClockHarnessProps = {
  time: number;
  duration: number;
  playbackRate: number;
  isActive: boolean;
  isSeeking?: boolean;
  tickIntervalMs: number;
  resetKey: string;
  onTime(time: number): void;
};

function ClockHarness(props: ClockHarnessProps) {
  const clockTime = useSmoothPlaybackClock(props);

  useEffect(() => {
    props.onTime(clockTime);
  }, [clockTime, props]);

  return null;
}

function ClockPairHarness(
  props: Omit<ClockHarnessProps, "onTime" | "tickIntervalMs"> & {
    onVisualTime(time: number): void;
    onSubtitleTime(time: number): void;
  },
) {
  const visualTime = useSmoothPlaybackClock({
    ...props,
    tickIntervalMs: VISUAL_PLAYBACK_CLOCK_TICK_MS,
  });
  const subtitleTime = useSmoothPlaybackClock({
    ...props,
    tickIntervalMs: SUBTITLE_PLAYBACK_CLOCK_TICK_MS,
  });

  useEffect(() => {
    props.onVisualTime(visualTime);
  }, [props, visualTime]);
  useEffect(() => {
    props.onSubtitleTime(subtitleTime);
  }, [props, subtitleTime]);

  return null;
}

describe("playback clock", () => {
  let root: Root;
  let container: HTMLDivElement;
  let now = 0;
  let nextAnimationFrame = 1;
  let animationFrames = new Map<number, FrameRequestCallback>();

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    now = 1_000;
    nextAnimationFrame = 1;
    animationFrames = new Map();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextAnimationFrame++;
      animationFrames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      animationFrames.delete(id);
    });
    window.requestAnimationFrame = globalThis.requestAnimationFrame;
    window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  async function renderClock(props: ClockHarnessProps) {
    await act(async () => {
      root.render(createElement(ClockHarness, props));
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function runAnimationFrame(timestamp: number) {
    now = timestamp;
    const callbacks = [...animationFrames.values()];
    animationFrames.clear();
    await act(async () => {
      callbacks.forEach((callback) => callback(timestamp));
    });
  }

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

  it("keeps visual and subtitle clocks on separate cadences", async () => {
    const visualTimes: number[] = [];
    const subtitleTimes: number[] = [];

    await act(async () => {
      root.render(
        createElement(ClockPairHarness, {
          time: 10,
          duration: 120,
          playbackRate: 1,
          isActive: true,
          resetKey: "source-a",
          onVisualTime: (time) => visualTimes.push(time),
          onSubtitleTime: (time) => subtitleTimes.push(time),
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    await runAnimationFrame(1_034);
    expect(visualTimes.at(-1)).toBe(10.034);
    expect(subtitleTimes.at(-1)).toBe(10);

    await runAnimationFrame(1_051);
    expect(visualTimes.at(-1)).toBe(10.034);
    expect(subtitleTimes.at(-1)).toBe(10.051);

    await runAnimationFrame(1_068);
    expect(visualTimes.at(-1)).toBe(10.068);
    expect(subtitleTimes.at(-1)).toBe(10.051);
  });

  it("does not move backward for a delayed authoritative sample", async () => {
    const times: number[] = [];
    const onTime = (time: number) => times.push(time);
    const props = {
      time: 10,
      duration: 120,
      playbackRate: 1,
      isActive: true,
      tickIntervalMs: VISUAL_PLAYBACK_CLOCK_TICK_MS,
      resetKey: "source-a",
      onTime,
    };

    await renderClock(props);
    await runAnimationFrame(1_400);
    expect(times.at(-1)).toBe(10.4);

    await renderClock({ ...props, time: 10.1 });
    await runAnimationFrame(1_650);
    expect(times.at(-1)).toBe(10.4);
  });

  it("freezes during buffering and resumes from the latest sample", async () => {
    const times: number[] = [];
    const onTime = (time: number) => times.push(time);
    const props = {
      time: 10,
      duration: 120,
      playbackRate: 1,
      isActive: true,
      tickIntervalMs: VISUAL_PLAYBACK_CLOCK_TICK_MS,
      resetKey: "source-a",
      onTime,
    };

    await renderClock(props);
    await runAnimationFrame(1_034);
    await renderClock({ ...props, isActive: false });
    expect(times.at(-1)).toBe(10);

    await runAnimationFrame(6_000);
    expect(times.at(-1)).toBe(10);

    await renderClock({ ...props, isActive: true });
    await runAnimationFrame(6_034);
    expect(times.at(-1)).toBe(10.034);
  });

  it("snaps immediately when the source identity changes", async () => {
    const times: number[] = [];
    const onTime = (time: number) => times.push(time);
    const props = {
      time: 20,
      duration: 120,
      playbackRate: 1,
      isActive: true,
      tickIntervalMs: VISUAL_PLAYBACK_CLOCK_TICK_MS,
      resetKey: "source-a",
      onTime,
    };

    await renderClock(props);
    await runAnimationFrame(2_000);
    expect(times.at(-1)).toBe(21);

    await renderClock({ ...props, time: 2, resetKey: "source-b" });
    expect(times.at(-1)).toBe(2);
  });
});
