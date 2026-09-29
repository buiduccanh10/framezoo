import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type DesktopPipState } from "@/desktop/pip";
import { playerStatus } from "@/stores/player/slices/source";

import {
  PipCaptions,
  PipPlaybackClockProvider,
  usePipSubtitleClock,
  usePipVisualClock,
} from "./DesktopPip";

type ClockProbeProps = {
  captionRevision: number;
  onClock(clock: { visual: number; subtitle: number }): void;
};

function ClockProbe(props: ClockProbeProps) {
  const visual = usePipVisualClock();
  const subtitle = usePipSubtitleClock();

  useEffect(() => {
    props.onClock({ visual, subtitle });
  }, [props, subtitle, visual]);

  return <output data-caption-revision={props.captionRevision} />;
}

function PipClockHarness(props: {
  state: DesktopPipState;
  captionRevision: number;
  onClock(clock: { visual: number; subtitle: number }): void;
}) {
  const state = {
    ...props.state,
    caption: {
      language: "en",
      vttData: `WEBVTT\n\n00:00:09.000 --> 00:00:11.000\ncaption ${props.captionRevision}`,
    },
  };

  return (
    <PipPlaybackClockProvider state={state} isDragging={false}>
      <ClockProbe
        captionRevision={props.captionRevision}
        onClock={props.onClock}
      />
      <PipCaptions state={state} controlsVisible />
    </PipPlaybackClockProvider>
  );
}

function createPipState(
  overrides: Partial<DesktopPipState> = {},
): DesktopPipState {
  return {
    source: { type: "hls", url: "https://example.com/source-a.m3u8" },
    status: playerStatus.PLAYING,
    sourceLoading: false,
    time: 10,
    duration: 120,
    paused: false,
    isPlaying: true,
    isSeeking: false,
    playbackRate: 1,
    title: "Test",
    logo: null,
    backdrop: null,
    isLoading: false,
    hasRenderedFrame: true,
    buffered: 60,
    playbackTarget: "pip",
    torrent: null,
    episode: { season: 1, episode: 1, title: "Episode 1" },
    nextEpisode: null,
    nextEpisodeIsSeasonChange: false,
    canControl: true,
    hideNextEpisodeButton: false,
    skipSegment: null,
    primaryDelay: 0,
    secondaryDelay: 0,
    caption: null,
    secondaryCaption: null,
    dualSubEnabled: false,
    ...overrides,
  };
}

describe("Desktop PiP playback clocks", () => {
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

  async function renderPip(
    state: DesktopPipState,
    captionRevision: number,
    onClock: ClockProbeProps["onClock"],
  ) {
    await act(async () => {
      root.render(
        createElement(PipClockHarness, { state, captionRevision, onClock }),
      );
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

  it("keeps the visual clock through a caption rerender and resets both clocks by source", async () => {
    const clocks: Array<{ visual: number; subtitle: number }> = [];
    const onClock = (clock: { visual: number; subtitle: number }) => {
      clocks.push(clock);
    };
    const sourceA = createPipState();

    await renderPip(sourceA, 1, onClock);
    await runAnimationFrame(1_034);
    expect(clocks.at(-1)).toEqual({ visual: 10.034, subtitle: 10 });

    await renderPip({ ...sourceA }, 2, onClock);
    expect(clocks.at(-1)).toEqual({ visual: 10.034, subtitle: 10 });

    await runAnimationFrame(1_068);
    expect(clocks.at(-1)).toEqual({ visual: 10.068, subtitle: 10.068 });

    await renderPip(
      createPipState({
        source: { type: "hls", url: "https://example.com/source-b.m3u8" },
        episode: { season: 1, episode: 2, title: "Episode 2" },
        time: 2,
      }),
      3,
      onClock,
    );
    expect(clocks.at(-1)).toEqual({ visual: 2, subtitle: 2 });
  });
});
