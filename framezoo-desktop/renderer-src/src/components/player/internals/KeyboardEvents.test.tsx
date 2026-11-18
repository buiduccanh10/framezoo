import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOverlayStack } from "@/stores/interface/overlayStack";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";
import { useSubtitleStore } from "@/stores/subtitles";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "@/utils/keyboardShortcuts";

import { KeyboardEvents } from "./KeyboardEvents";

function dispatchWindowKeyDown(
  init: KeyboardEventInit & { code?: string; isComposing?: boolean },
) {
  const evt = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  window.dispatchEvent(evt);
  return evt;
}

describe("KeyboardEvents subtitle delay shortcuts", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();

    usePlayerStore.getState().reset();
    usePlayerStore.setState((s) => {
      s.mediaPlaying.hasRenderedFrame = true;
      s.mediaPlaying.isLoading = false;
      s.mediaPlaying.isPaused = false;
      s.subtitleSync.active = false;
      s.caption.activeTrack = "primary";
    });
    useSubtitleStore.setState({
      primaryDelay: 0,
      secondaryDelay: 0,
      showDelayIndicator: false,
    });
    useOverlayStack.setState({ currentOverlay: null });
    usePreferencesStore.setState({
      keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <MemoryRouter>
          <KeyboardEvents />
        </MemoryRouter>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePlayerStore.getState().reset();
    useOverlayStack.setState({ currentOverlay: null });
    vi.useRealTimers();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it("adjusts primary subtitle delay on the very first [ and ] press", () => {
    act(() => {
      dispatchWindowKeyDown({ key: "[", code: "BracketLeft" });
    });

    expect(useSubtitleStore.getState().primaryDelay).toBe(-0.5);
    expect(useSubtitleStore.getState().showDelayIndicator).toBe(true);
    expect(useOverlayStack.getState().currentOverlay).toBe("subtitle");

    act(() => {
      dispatchWindowKeyDown({ key: "]", code: "BracketRight" });
    });

    expect(useSubtitleStore.getState().primaryDelay).toBe(0);
    expect(useSubtitleStore.getState().showDelayIndicator).toBe(true);
  });

  it("adjusts on every press even when Vietnamese Telex sends ơ/ư on odd presses and [/] on even presses", () => {
    act(() => {
      dispatchWindowKeyDown({ key: "ơ", code: "KeyA" });
    });
    expect(useSubtitleStore.getState().primaryDelay).toBe(-0.5);

    act(() => {
      dispatchWindowKeyDown({ key: "[", code: "BracketLeft" });
    });
    expect(useSubtitleStore.getState().primaryDelay).toBe(-1);

    act(() => {
      dispatchWindowKeyDown({ key: "ư", code: "" });
    });
    expect(useSubtitleStore.getState().primaryDelay).toBe(-0.5);

    act(() => {
      dispatchWindowKeyDown({ key: "]", code: "BracketRight" });
    });
    expect(useSubtitleStore.getState().primaryDelay).toBe(0);
  });

  it("adjusts secondary subtitle delay when secondary track is active", () => {
    act(() => {
      usePlayerStore.getState().setActiveCaptionTrack("secondary");
    });

    act(() => {
      dispatchWindowKeyDown({ key: "]", code: "BracketRight" });
    });

    expect(useSubtitleStore.getState().secondaryDelay).toBe(0.5);
    expect(useSubtitleStore.getState().primaryDelay).toBe(0);
  });

  it("throttles held repeat events without dropping rapid single presses", () => {
    // Rapid non-repeat taps must never be dropped
    act(() => {
      dispatchWindowKeyDown({ key: "[", code: "BracketLeft", repeat: false });
      dispatchWindowKeyDown({ key: "[", code: "BracketLeft", repeat: false });
      dispatchWindowKeyDown({ key: "[", code: "BracketLeft", repeat: false });
    });
    expect(useSubtitleStore.getState().primaryDelay).toBe(-1.5);

    // Held repeat within 150ms should throttle smoothly
    act(() => {
      vi.advanceTimersByTime(30);
      dispatchWindowKeyDown({ key: "[", code: "BracketLeft", repeat: true });
      vi.advanceTimersByTime(30);
      dispatchWindowKeyDown({ key: "[", code: "BracketLeft", repeat: true });
    });
    expect(useSubtitleStore.getState().primaryDelay).toBe(-1.5);

    act(() => {
      vi.advanceTimersByTime(100);
      dispatchWindowKeyDown({ key: "[", code: "BracketLeft", repeat: true });
    });
    expect(useSubtitleStore.getState().primaryDelay).toBe(-2);
  });
});
