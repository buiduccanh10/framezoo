import { describe, expect, it } from "vitest";

import { getDesktopPipStateFromPlayerState } from "./pip";

describe("Desktop PiP subtitle state", () => {
  it("carries both subtitle delays into the separate PiP renderer", () => {
    const state = getDesktopPipStateFromPlayerState(
      {
        source: {
          type: "hls",
          url: "https://example.com/video.m3u8",
        },
        currentQuality: null,
        progress: {
          time: 42,
          duration: 120,
        },
        mediaPlaying: {
          isPaused: false,
          playbackRate: 1,
        },
        meta: {
          title: "Test movie",
        },
        caption: {
          selected: null,
          secondary: null,
          dualSubEnabled: false,
        },
      } as never,
      1.25,
      -0.5,
    );

    expect(state?.primaryDelay).toBe(1.25);
    expect(state?.secondaryDelay).toBe(-0.5);
  });

  it("keeps loading metadata and episode actions when the source is empty", () => {
    const state = getDesktopPipStateFromPlayerState({
      source: null,
      currentQuality: null,
      progress: {
        time: 5,
        duration: 120,
        buffered: 8,
      },
      mediaPlaying: {
        isPaused: false,
        playbackRate: 1,
        isLoading: true,
        hasRenderedFrame: false,
      },
      meta: {
        type: "show",
        title: "Test show",
        season: { number: 1 },
        episode: { number: 1, title: "Episode 1" },
        episodes: [
          { number: 1, title: "Episode 1" },
          { number: 2, title: "Episode 2" },
        ],
      },
      skipSegments: [
        {
          type: "intro",
          start_ms: 0,
          end_ms: 10_000,
        },
      ],
      caption: {
        selected: null,
        secondary: null,
        dualSubEnabled: false,
      },
    } as never);

    expect(state?.source).toBeNull();
    expect(state?.isLoading).toBe(true);
    expect(state?.hasRenderedFrame).toBe(false);
    expect(state?.nextEpisode?.episode).toBe(2);
    expect(state?.skipSegment).toMatchObject({
      type: "intro",
      startTime: 0,
      endTime: 10,
      visibility: "always",
      isEndingAtVideoEnd: false,
    });
  });
});
