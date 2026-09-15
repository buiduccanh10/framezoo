import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/stores/player/store";

import { usePlayerStatusPolling } from "./usePlayerStatusPolling";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function PollingHarness() {
  const { latestStatus } = usePlayerStatusPolling();
  const currentTime = usePlayerStore((state) => state.progress.time);

  return (
    <>
      <output data-testid="latest-status">
        {latestStatus ? JSON.stringify(latestStatus) : ""}
      </output>
      <output data-testid="current-time">{currentTime}</output>
    </>
  );
}

describe("usePlayerStatusPolling", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    usePlayerStore.getState().reset();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePlayerStore.getState().reset();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps one interval while polling the latest store state", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    await act(async () => {
      root.render(<PollingHarness />);
      await Promise.resolve();
    });

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      const { mediaPlaying, progress } = usePlayerStore.getState();
      usePlayerStore.setState({
        mediaPlaying: {
          ...mediaPlaying,
          hasPlayedOnce: true,
          isPlaying: true,
          isPaused: false,
        },
        progress: {
          ...progress,
          time: 10,
          duration: 120,
        },
      });
      expect(usePlayerStore.getState().mediaPlaying.hasPlayedOnce).toBe(true);
      expect(usePlayerStore.getState().progress.time).toBe(10);
      await vi.advanceTimersByTimeAsync(2_000);
    });

    const latestStatus = JSON.parse(
      container.querySelector("[data-testid='latest-status']")?.textContent ??
        "",
    ) as {
      hasPlayedOnce: boolean;
      isPlaying: boolean;
      time: number;
      duration: number;
    };

    expect(
      container.querySelector("[data-testid='current-time']")?.textContent,
    ).toBe("10");
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(latestStatus).toMatchObject({
      hasPlayedOnce: true,
      isPlaying: true,
      time: 10,
      duration: 120,
    });
  });
});
