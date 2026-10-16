import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PlayerHoverState } from "@/stores/player/slices/interface";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

import { useShouldShowControls } from "./useShouldShowControls";

function ControlsHarness({
  onResult,
}: {
  onResult(result: { showTargets: boolean; showTouchTargets: boolean }): void;
}) {
  const result = useShouldShowControls();
  onResult(result);
  return null;
}

describe("useShouldShowControls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    usePlayerStore.getState().reset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePlayerStore.getState().reset();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it("shows controls when user hovers or moves cursor", () => {
    let latestResult: { showTargets: boolean } = { showTargets: false };

    usePlayerStore.setState((s) => {
      s.status = playerStatus.PLAYING;
      s.mediaPlaying.hasRenderedFrame = true;
      s.mediaPlaying.isPlaying = true;
      s.mediaPlaying.isPaused = false;
      s.mediaPlaying.isLoading = false;
      s.interface.hovering = PlayerHoverState.MOUSE_HOVER;
    });

    act(() => {
      root.render(
        <ControlsHarness
          onResult={(res) => {
            latestResult = res;
          }}
        />,
      );
    });

    expect(latestResult.showTargets).toBe(true);
  });

  it("shows controls when video is paused", () => {
    let latestResult: { showTargets: boolean } = { showTargets: false };

    usePlayerStore.setState((s) => {
      s.status = playerStatus.PLAYING;
      s.mediaPlaying.hasRenderedFrame = true;
      s.mediaPlaying.isPlaying = false;
      s.mediaPlaying.isPaused = true;
      s.mediaPlaying.isLoading = false;
      s.interface.hovering = PlayerHoverState.NOT_HOVERING;
    });

    act(() => {
      root.render(
        <ControlsHarness
          onResult={(res) => {
            latestResult = res;
          }}
        />,
      );
    });

    expect(latestResult.showTargets).toBe(true);
  });

  it("shows controls when video is buffering / loading", () => {
    let latestResult: { showTargets: boolean } = { showTargets: false };

    usePlayerStore.setState((s) => {
      s.status = playerStatus.PLAYING;
      s.mediaPlaying.hasRenderedFrame = true;
      s.mediaPlaying.isPlaying = true;
      s.mediaPlaying.isPaused = false;
      s.mediaPlaying.isLoading = true;
      s.interface.hovering = PlayerHoverState.NOT_HOVERING;
    });

    act(() => {
      root.render(
        <ControlsHarness
          onResult={(res) => {
            latestResult = res;
          }}
        />,
      );
    });

    expect(latestResult.showTargets).toBe(true);
  });

  it("shows controls before the first frame has rendered in PLAYING state", () => {
    let latestResult: { showTargets: boolean } = { showTargets: false };

    usePlayerStore.setState((s) => {
      s.status = playerStatus.PLAYING;
      s.mediaPlaying.hasRenderedFrame = false;
      s.mediaPlaying.isPlaying = true;
      s.mediaPlaying.isPaused = false;
      s.mediaPlaying.isLoading = false;
      s.interface.hovering = PlayerHoverState.NOT_HOVERING;
    });

    act(() => {
      root.render(
        <ControlsHarness
          onResult={(res) => {
            latestResult = res;
          }}
        />,
      );
    });

    expect(latestResult.showTargets).toBe(true);
  });

  it("hides controls when playing smoothly without hovering or open overlays", () => {
    let latestResult: { showTargets: boolean } = { showTargets: true };

    usePlayerStore.setState((s) => {
      s.status = playerStatus.PLAYING;
      s.mediaPlaying.hasRenderedFrame = true;
      s.mediaPlaying.isPlaying = true;
      s.mediaPlaying.isPaused = false;
      s.mediaPlaying.isLoading = false;
      s.interface.hovering = PlayerHoverState.NOT_HOVERING;
      s.interface.isHoveringControls = false;
      s.interface.hasOpenOverlay = false;
    });

    act(() => {
      root.render(
        <ControlsHarness
          onResult={(res) => {
            latestResult = res;
          }}
        />,
      );
    });

    expect(latestResult.showTargets).toBe(false);
  });
});
