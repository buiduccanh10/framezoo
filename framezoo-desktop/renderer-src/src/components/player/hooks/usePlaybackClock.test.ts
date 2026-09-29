import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_EXTRAPOLATION_SECONDS,
  SUBTITLE_PLAYBACK_CLOCK_TICK_MS,
  VISUAL_PLAYBACK_CLOCK_TICK_MS,
  advancePlaybackClockState,
  createPlaybackClockState,
  getProjectedPlaybackTime,
  reconcilePlaybackClockState,
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

  it("continues past a delayed authoritative sample without re-anchoring", async () => {
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
    expect(times.at(-1)).toBe(10.65);
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
    expect(times.at(-1)).toBe(10.034);

    await runAnimationFrame(6_000);
    expect(times.at(-1)).toBe(10.034);

    await renderClock({ ...props, isActive: true });
    await runAnimationFrame(6_034);
    expect(times.at(-1)).toBeCloseTo(10.068, 6);
  });

  it("drops a stale backward sample while continuing from the existing anchor", () => {
    const input = {
      time: 10,
      duration: 120,
      playbackRate: 1,
      isActive: true,
      resetKey: "source-a",
    };
    let state = createPlaybackClockState(input, 1_000);
    state = advancePlaybackClockState(state, input.duration, 1_400);
    state = reconcilePlaybackClockState(state, { ...input, time: 10.1 }, 1_400);

    expect(state.time).toBe(10.4);
    expect(advancePlaybackClockState(state, input.duration, 1_650).time).toBe(
      10.65,
    );
  });

  it("freezes while buffering then resumes from its stable clock", () => {
    const input = {
      time: 10,
      duration: 120,
      playbackRate: 1,
      isActive: true,
      resetKey: "source-a",
    };
    let state = createPlaybackClockState(input, 1_000);
    state = advancePlaybackClockState(state, input.duration, 1_034);
    state = reconcilePlaybackClockState(
      state,
      { ...input, time: 10.05, isLoading: true },
      1_034,
    );

    expect(advancePlaybackClockState(state, input.duration, 6_000).time).toBe(
      10.05,
    );

    state = reconcilePlaybackClockState(
      state,
      { ...input, time: 10.05 },
      6_000,
    );
    expect(
      advancePlaybackClockState(state, input.duration, 6_034).time,
    ).toBeCloseTo(10.084, 6);
  });

  it("snaps for backward and forward seeks, plus a source reset", () => {
    const input = {
      time: 20,
      duration: 120,
      playbackRate: 1,
      isActive: true,
      resetKey: "source-a",
    };
    let state = createPlaybackClockState(input, 1_000);

    state = reconcilePlaybackClockState(
      state,
      { ...input, time: 5, isSeeking: true },
      2_000,
    );
    expect(state.time).toBe(5);

    state = reconcilePlaybackClockState(
      state,
      { ...input, time: 45, isSeeking: false },
      2_100,
    );
    expect(state.time).toBe(45);

    state = reconcilePlaybackClockState(
      state,
      { ...input, time: 2, resetKey: "source-b" },
      2_200,
    );
    expect(state.time).toBe(2);
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
