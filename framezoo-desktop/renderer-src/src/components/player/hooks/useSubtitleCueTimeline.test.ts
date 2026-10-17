import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { afterEach, beforeEach, vi } from "vitest";

import type { CaptionCueType } from "@/components/player/utils/captions";

import {
  getNextSubtitleCueBoundary,
  getSkippedSubtitleCueIndices,
  useSubtitleCueBoundaryWakeup,
} from "./useSubtitleCueTimeline";

const cues = [
  { start: 1_000, end: 1_400, content: "first" },
  { start: 1_400, end: 1_850, content: "second" },
  { start: 2_100, end: 2_180, content: "short" },
] as CaptionCueType[];

describe("subtitle cue timeline", () => {
  it("schedules the next start and end boundary including subtitle delay", () => {
    expect(getNextSubtitleCueBoundary(cues, 0.25, 0.5)).toBe(1.25);
    expect(getNextSubtitleCueBoundary(cues, 0.25, 1.3)).toBe(1.65);
    expect(getNextSubtitleCueBoundary(cues, 0, 2.2)).toBeNull();
  });

  it("does not classify a cue as skipped when updates hit its visible window", () => {
    expect(getSkippedSubtitleCueIndices(cues, 0, 0.99, 1.01)).toEqual([]);
    expect(getSkippedSubtitleCueIndices(cues, 0, 1.01, 1.39)).toEqual([]);
  });

  it("identifies narrow and adjacent cues crossed between renders", () => {
    expect(getSkippedSubtitleCueIndices(cues, 0, 0.9, 1.9)).toEqual([0, 1]);
    expect(getSkippedSubtitleCueIndices(cues, 0, 2.0, 2.2)).toEqual([2]);
  });

  it("does not treat backward seek or same-time render as skipped playback", () => {
    expect(getSkippedSubtitleCueIndices(cues, 0, 2.2, 0.9)).toEqual([]);
    expect(getSkippedSubtitleCueIndices(cues, 0, 1.1, 1.1)).toEqual([]);
  });

  describe("boundary wakeup", () => {
    let root: Root;
    let container: HTMLDivElement;

    function BoundaryHarness(props: { onWake(): void }) {
      const version = useSubtitleCueBoundaryWakeup(
        [{ start: 1_000, end: 1_200, content: "short" }] as CaptionCueType[],
        0,
        0.9,
        {
          surface: "main",
          resetKey: "source-a:caption-a",
          playbackRate: 1,
          isFrozen: false,
          isSeeking: false,
          isPlaybackStalled: false,
          status: "playing",
          authoritativeTime: 0.9,
        },
      );
      useEffect(() => {
        if (version > 0) props.onWake();
      }, [props, version]);
      return null;
    }

    beforeEach(() => {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      vi.useFakeTimers();
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    });

    afterEach(() => {
      act(() => root.unmount());
      container.remove();
      vi.useRealTimers();
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT;
    });

    it("wakes the subtitle renderer at the next cue boundary", async () => {
      const onWake = vi.fn();
      await act(async () => {
        root.render(createElement(BoundaryHarness, { onWake }));
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(onWake).toHaveBeenCalledTimes(1);
    });
  });
});
