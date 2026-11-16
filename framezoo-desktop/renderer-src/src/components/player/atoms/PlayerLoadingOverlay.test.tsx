import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stableT = (key: string, defaultValue?: string) => defaultValue ?? key;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: stableT,
  }),
}));

vi.mock("@/desktop/torrentPlaybackStore", () => ({
  useActiveTorrentStatus: () => null,
}));

vi.mock("@/stores/player/slices/source", () => ({
  playerStatus: {
    IDLE: "idle",
    PLAYBACK: "playback",
    PLAYING: "playing",
    SCRAPING: "scraping",
    SCRAPE_NOT_FOUND: "scrapeNotFound",
    PLAYBACK_ERROR: "playbackError",
  },
}));

vi.mock("@/stores/player/store", () => ({
  usePlayerStore: () => null,
}));

vi.mock("@/components/utils/Image", () => ({
  LazyImage: (props: { src?: string; alt?: string; className?: string }) =>
    createElement("img", {
      src: props.src,
      alt: props.alt,
      className: props.className,
    }),
}));

import { PlayerLoadingOverlayView } from "./PlayerLoadingOverlay";

describe("PlayerLoadingOverlayView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps backdrop image mounted while fading out after playback starts", () => {
    act(() => {
      root.render(
        createElement(PlayerLoadingOverlayView, {
          show: true,
          progress: 50,
          title: "Hannibal",
          backdrop: "https://example.com/backdrop.jpg",
          showBackdrop: true,
        }),
      );
    });

    expect(
      container.querySelector('img[src="https://example.com/backdrop.jpg"]'),
    ).not.toBeNull();

    // Flip show -> false to begin the 300ms opacity fadeout transition
    act(() => {
      root.render(
        createElement(PlayerLoadingOverlayView, {
          show: false,
          progress: 100,
          title: "Hannibal",
          backdrop: "https://example.com/backdrop.jpg",
          showBackdrop: true,
        }),
      );
    });

    // Backdrop stays rendered during the 300ms fadeout (no black-screen flash)
    expect(
      container.querySelector('img[src="https://example.com/backdrop.jpg"]'),
    ).not.toBeNull();
  });
});
