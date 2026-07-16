import { describe, expect, it } from "vitest";

import { getDesktopPipStateFromPlayerState } from "./pip";

describe("Desktop PiP subtitle state", () => {
  it("carries the current subtitle delay into the separate PiP renderer", () => {
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
    );

    expect(state?.delay).toBe(1.25);
  });
});
