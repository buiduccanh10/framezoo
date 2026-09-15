import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

import { MediaSession } from "./MediaSession";

vi.mock("../hooks/usePlayerMeta", () => ({
  usePlayerMeta: () => ({ setDirectMeta: vi.fn() }),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

class TestMediaMetadata {
  constructor(init: MediaMetadataInit) {
    Object.assign(this, init);
  }
}

describe("MediaSession", () => {
  let root: Root;
  let container: HTMLDivElement;
  let mediaSession: {
    metadata: unknown;
    playbackState: MediaSessionPlaybackState;
    setActionHandler: ReturnType<typeof vi.fn>;
    setPositionState: ReturnType<typeof vi.fn>;
  };
  let actionHandlers: Map<MediaSessionAction, MediaSessionActionHandler | null>;
  let audio: {
    pause: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
    setAttribute: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
    preload: string;
    loop: boolean;
    volume: number;
  };
  let mediaSessionDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    usePlayerStore.getState().reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    actionHandlers = new Map();
    mediaSession = {
      metadata: null,
      playbackState: "none",
      setActionHandler: vi.fn(
        (
          action: MediaSessionAction,
          handler: MediaSessionActionHandler | null,
        ) => {
          actionHandlers.set(action, handler);
        },
      ),
      setPositionState: vi.fn(),
    };
    mediaSessionDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaSession",
    );
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: mediaSession,
    });

    audio = {
      pause: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      load: vi.fn(),
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      preload: "",
      loop: false,
      volume: 0,
    };
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        return audio;
      }),
    );
    vi.stubGlobal("MediaMetadata", TestMediaMetadata);
    (
      window as Window & { __FRAMEZOO_DESKTOP__?: boolean }
    ).__FRAMEZOO_DESKTOP__ = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePlayerStore.setState({ display: null });
    usePlayerStore.getState().reset();
    if (mediaSessionDescriptor) {
      Object.defineProperty(navigator, "mediaSession", mediaSessionDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "mediaSession");
    }
    delete (window as Window & { __FRAMEZOO_DESKTOP__?: boolean })
      .__FRAMEZOO_DESKTOP__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("bridges native playback state and system actions to the active display", async () => {
    const display = {
      pause: vi.fn(),
      play: vi.fn(),
      setTime: vi.fn(),
    };
    const state = usePlayerStore.getState();
    usePlayerStore.setState({
      display: display as never,
      status: playerStatus.PLAYING,
      meta: {
        type: "show",
        title: "The Show",
        tmdbId: "1",
        releaseYear: 2026,
        poster: "https://example.test/poster.png",
        season: { number: 2, tmdbId: "season-2", title: "Season 2" },
        episode: { number: 3, tmdbId: "episode-3", title: "Episode 3" },
        episodes: [
          { number: 2, tmdbId: "episode-2", title: "Episode 2" },
          { number: 3, tmdbId: "episode-3", title: "Episode 3" },
          { number: 4, tmdbId: "episode-4", title: "Episode 4" },
        ],
      },
      mediaPlaying: {
        ...state.mediaPlaying,
        hasPlayedOnce: true,
        hasRenderedFrame: true,
        isPaused: false,
        isPlaying: true,
      },
      progress: {
        ...state.progress,
        duration: 120,
        time: 42,
      },
    });

    await act(async () => {
      root.render(<MediaSession />);
      await Promise.resolve();
    });

    expect(mediaSession.metadata).toMatchObject({
      album: "Season 2",
      artist: "The Show",
      title: "S2 E3: Episode 3",
    });
    expect(mediaSession.playbackState).toBe("playing");
    expect(mediaSession.setPositionState).toHaveBeenCalledWith({
      duration: 120,
      playbackRate: 1,
      position: 42,
    });
    expect(audio.play).toHaveBeenCalledTimes(1);

    await act(async () => {
      actionHandlers.get("pause")?.({} as MediaSessionActionDetails);
      actionHandlers.get("seekforward")?.({
        seekOffset: 15,
      } as MediaSessionActionDetails);
    });

    expect(display.pause).toHaveBeenCalledTimes(1);
    expect(display.setTime).toHaveBeenCalledWith(57);

    await act(async () => {
      const nextState = usePlayerStore.getState();
      usePlayerStore.setState({
        status: playerStatus.IDLE,
        mediaPlaying: {
          ...nextState.mediaPlaying,
          isPaused: true,
          isPlaying: false,
        },
      });
      await Promise.resolve();
    });

    expect(mediaSession.metadata).toBeNull();
    expect(mediaSession.playbackState).toBe("none");
    expect(actionHandlers.get("play")).toBeNull();
    expect(audio.pause).toHaveBeenCalled();
  });
});
