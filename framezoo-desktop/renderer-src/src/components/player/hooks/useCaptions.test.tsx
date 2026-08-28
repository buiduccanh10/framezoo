import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLanguageStore } from "@/stores/language";
import type {
  CaptionListItem,
  PlayerMeta,
} from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import type { SourceSliceSource } from "@/stores/player/utils/qualities";
import { useSubtitleStore } from "@/stores/subtitles";
import { queryClient } from "@/utils/queryClient";

import { useCaptions } from "./useCaptions";

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

function CaptionsHarness() {
  useCaptions();
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
