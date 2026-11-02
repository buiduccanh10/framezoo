import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DisplayInterface,
  DisplayInterfaceEvents,
} from "@/components/player/display/displayInterface";
import { useLanguageStore } from "@/stores/language";
import type {
  CaptionListItem,
  PlayerMeta,
} from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import type { SourceSliceSource } from "@/stores/player/utils/qualities";
import { useSubtitleStore } from "@/stores/subtitles";
import { makeEmitter } from "@/utils/events";
import { queryClient } from "@/utils/queryClient";

import {
  pauseAndWaitForStablePlaybackPosition,
  useCaptions,
} from "./useCaptions";

const mocks = vi.hoisted(() => ({
  downloadCaptionAsVtt: vi.fn(),
  loadAllAddonSubtitles: vi.fn(),
  scoreCaptionSourceFit: vi.fn(),
}));

vi.mock("@/backend/helpers/subs", () => ({
  downloadCaptionAsVtt: mocks.downloadCaptionAsVtt,
}));

vi.mock("@/components/player/hooks/useSkipTime", () => ({
  useSkipTime: () => [],
}));

vi.mock("@/components/player/utils/captionSourceFit", () => ({
  scoreCaptionSourceFit: mocks.scoreCaptionSourceFit,
}));

vi.mock("@/desktop/addons/subtitles", () => ({
  loadAllAddonSubtitles: mocks.loadAllAddonSubtitles,
}));

function createMeta(episode: number): PlayerMeta {
  return {
    type: "show",
    title: "Test Show",
    tmdbId: "1405",
    imdbId: "tt0773262",
    releaseYear: 2006,
    season: {
      number: 1,
      tmdbId: "season-1",
      title: "Season 1",
    },
    episode: {
      number: episode,
      tmdbId: `episode-${episode}`,
      title: `Episode ${episode}`,
    },
  };
}

function createSource(id: string): SourceSliceSource {
  return {
    id,
    type: "file",
    quality: "720",
    qualities: {
      "720": {
        type: "mp4",
        url: `https://example.com/${id}.mp4`,
      },
    },
  };
}

function createCaption(id: string): CaptionListItem {
  return {
    id,
    language: "vi",
    url: `https://sub.wyzie.io/${id}.vtt`,
    type: "vtt",
    needsProxy: false,
    opensubtitles: true,
    source: "wyzie",
  };
}

function CaptionsHarness({
  onReady,
}: {
  onReady?: (controls: ReturnType<typeof useCaptions>) => void;
}) {
  const controls = useCaptions();

  useEffect(() => {
    onReady?.(controls);
  }, [controls, onReady]);

  return null;
}

describe("caption auto-selection across episode transitions", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    queryClient.clear();
    usePlayerStore.getState().reset();
    useSubtitleStore.setState({
      enabled: true,
      lastSelectedLanguage: "vi",
    });
    useLanguageStore.setState({ language: "en" });
    mocks.scoreCaptionSourceFit.mockResolvedValue({
      score: 100,
      confidence: "high",
    });
    mocks.loadAllAddonSubtitles.mockResolvedValue({
      captions: [],
      errors: [],
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePlayerStore.getState().reset();
    useSubtitleStore.setState({
      enabled: false,
      lastSelectedLanguage: null,
    });
    vi.useRealTimers();
  });

  it("ignores a late VTT download from the previous episode", async () => {
    const episodeOneCaption = createCaption("episode-1-vietnamese");
    const episodeTwoCaption = createCaption("episode-2-vietnamese");
    let resolveEpisodeOne: ((vtt: string) => void) | undefined;

    mocks.loadAllAddonSubtitles
      .mockResolvedValueOnce({
        captions: [episodeOneCaption],
        errors: [],
      })
      .mockResolvedValueOnce({
        captions: [episodeTwoCaption],
        errors: [],
      });
    mocks.downloadCaptionAsVtt.mockImplementation(
      (caption: CaptionListItem) => {
        if (caption.id === episodeOneCaption.id) {
          return new Promise<string>((resolve) => {
            resolveEpisodeOne = resolve;
          });
        }
        return Promise.resolve(
          `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${caption.id}`,
        );
      },
    );

    await act(async () => {
      root.render(<CaptionsHarness />);
      const store = usePlayerStore.getState();
      store.setMeta(createMeta(1));
      store.setSource(createSource("source-1"), [], 0);
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
    });

    expect(mocks.downloadCaptionAsVtt).toHaveBeenCalledWith(episodeOneCaption);

    await act(async () => {
      const store = usePlayerStore.getState();
      store.setMeta(createMeta(2), "sourceSelection");
      store.setSource(createSource("source-2"), [], 0);
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(usePlayerStore.getState().caption.selected?.id).toBe(
      episodeTwoCaption.id,
    );

    await act(async () => {
      resolveEpisodeOne?.("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nEpisode 1");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(usePlayerStore.getState().caption.selected?.id).toBe(
      episodeTwoCaption.id,
    );
  });
});

describe("manual subtitle cycling", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    usePlayerStore.getState().reset();
    useSubtitleStore.setState({
      enabled: false,
      lastSelectedLanguage: "vi",
    });
    useLanguageStore.setState({ language: "en" });
    mocks.downloadCaptionAsVtt.mockResolvedValue("WEBVTT");
    mocks.scoreCaptionSourceFit.mockImplementation(async (caption) =>
      caption.id === "rank-1" ? { score: 100, confidence: "high" } : null,
    );
    mocks.loadAllAddonSubtitles.mockResolvedValue({
      captions: [],
      errors: [],
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePlayerStore.getState().reset();
    useSubtitleStore.setState({
      enabled: false,
      lastSelectedLanguage: null,
    });
  });

  it("cycles through lower-ranked subtitles and wraps to the highest", async () => {
    const captions = [
      createCaption("rank-1"),
      createCaption("rank-2"),
      createCaption("rank-3"),
    ];
    const store = usePlayerStore.getState();
    store.setMeta(createMeta(1));
    store.setSource(createSource("source-1"), captions, 0);
    store.setCaption({
      id: "rank-1",
      language: "vi",
      url: captions[0].url,
      vttData: "WEBVTT",
    });

    let controls: ReturnType<typeof useCaptions> | null = null;
    await act(async () => {
      root.render(<CaptionsHarness onReady={(value) => (controls = value)} />);
      await Promise.resolve();
    });

    expect(controls).not.toBeNull();
    await act(async () => {
      await controls?.selectNextBestCaptionForLanguage("vi");
    });
    expect(usePlayerStore.getState().caption.selected?.id).toBe("rank-2");

    await act(async () => {
      await controls?.selectNextBestCaptionForLanguage("vi");
    });
    expect(usePlayerStore.getState().caption.selected?.id).toBe("rank-3");

    await act(async () => {
      await controls?.selectNextBestCaptionForLanguage("vi");
    });
    expect(usePlayerStore.getState().caption.selected?.id).toBe("rank-1");
  });

  it("uses the same ranked cycle for the Auto select action", async () => {
    const captions = [
      createCaption("rank-1"),
      createCaption("rank-2"),
      createCaption("rank-3"),
    ];
    const store = usePlayerStore.getState();
    store.setMeta(createMeta(1));
    store.setSource(createSource("source-1"), captions, 0);
    store.setCaption({
      id: "rank-1",
      language: "vi",
      url: captions[0].url,
      vttData: "WEBVTT",
    });

    let controls: ReturnType<typeof useCaptions> | null = null;
    await act(async () => {
      root.render(<CaptionsHarness onReady={(value) => (controls = value)} />);
      await Promise.resolve();
    });

    await act(async () => {
      await controls?.selectBestCaptionFromLastUsedLanguage();
    });
    expect(usePlayerStore.getState().caption.selected?.id).toBe("rank-2");
  });
});

describe("subtitle sync pause barrier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlayerStore.getState().reset();
    usePlayerStore.setState((state) => ({
      progress: { ...state.progress, time: 12.5 },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    usePlayerStore.getState().reset();
  });

  function makeDisplay() {
    const emitter = makeEmitter<DisplayInterfaceEvents>();
    const display = {
      on: emitter.on,
      off: emitter.off,
      pause: vi.fn(),
    } as unknown as DisplayInterface;
    return { display, emit: emitter.emit };
  }

  it("waits for native pause confirmation and stable progress before capture", async () => {
    const { display, emit } = makeDisplay();
    const result = pauseAndWaitForStablePlaybackPosition(
      display,
      false,
      new AbortController().signal,
    );

    expect(display.pause).toHaveBeenCalledOnce();
    emit("pauseconfirmed", undefined);
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe(12.5);
  });

  it("does not return a capture position when native pause is not confirmed", async () => {
    const { display } = makeDisplay();
    const result = pauseAndWaitForStablePlaybackPosition(
      display,
      false,
      new AbortController().signal,
    );

    await vi.advanceTimersByTimeAsync(1500);
    await expect(result).resolves.toBeNull();
  });
});
