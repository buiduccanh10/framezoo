import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DisplayInterface } from "@/components/player/display/displayInterface";

import { usePlayerStore } from "../store";
import type { Caption, CaptionListItem, PlayerMeta } from "./source";
import type { SourceSliceSource } from "../utils/qualities";

type ProgressUpdate = {
  captions: CaptionListItem[];
  completed: number;
  total: number;
  sourceName: string;
};

type ProgressHandler = (update: ProgressUpdate) => void;

const subtitleMocks = vi.hoisted(() => ({
  handlers: [] as ProgressHandler[],
  scrape: vi.fn(),
}));

vi.mock("@/utils/externalSubtitles", () => ({
  scrapeExternalSubtitles: subtitleMocks.scrape,
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

describe("external subtitle source transitions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    subtitleMocks.handlers.length = 0;
    usePlayerStore.getState().reset();
    subtitleMocks.scrape.mockImplementation(
      async (
        _meta: PlayerMeta,
        onProgress?: (update: ProgressUpdate) => void,
      ) => {
        if (onProgress) {
          subtitleMocks.handlers.push(onProgress);
        }
        return [];
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps captions when an older request belongs to the current episode", async () => {
    const store = usePlayerStore.getState();

    store.setMeta(createMeta(5));
    store.setSource(createSource("source-a"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    store.setSource(createSource("source-b"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    const caption = createCaption("episode-5-vietnamese");
    const handlers = subtitleMocks.handlers;
    expect(handlers).toHaveLength(2);

    handlers[0]({
      captions: [caption],
      completed: 1,
      total: 4,
      sourceName: "Wyzie",
    });

    expect(usePlayerStore.getState().captionList).toContainEqual(caption);
  });

  it("rejects a late caption response from the previous episode", async () => {
    const store = usePlayerStore.getState();

    store.setMeta(createMeta(4));
    store.setSource(createSource("source-a"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    store.setMeta(createMeta(5));
    store.setSource(createSource("source-b"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    const oldEpisodeCaption = createCaption("episode-4-vietnamese");
    const handlers = subtitleMocks.handlers;
    expect(handlers).toHaveLength(2);

    handlers[0]({
      captions: [oldEpisodeCaption],
      completed: 1,
      total: 4,
      sourceName: "Wyzie",
    });

    expect(usePlayerStore.getState().captionList).not.toContainEqual(
      oldEpisodeCaption,
    );
  });

  it("preserves playback intent across source switches", async () => {
    const load = vi.fn();
    const display = {
      load,
      destroy: vi.fn(),
      getType: () => "web",
      on: vi.fn(),
      setCaption: vi.fn(),
      setSecondaryCaption: vi.fn(),
    } as unknown as DisplayInterface;
    usePlayerStore.getState().setDisplay(display);

    const store = usePlayerStore.getState();
    store.setMeta(createMeta(1));
    store.setSource(createSource("source-a"), [], 0);

    const playing = usePlayerStore.getState().mediaPlaying;
    usePlayerStore.setState({
      mediaPlaying: { ...playing, isPlaying: true, isPaused: false },
    });

    usePlayerStore.getState().setMeta(createMeta(2));
    usePlayerStore.getState().setSource(createSource("source-b"), [], 0);

    const state = usePlayerStore.getState();
    expect(state.mediaPlaying.isPlaying).toBe(true);
    expect(state.mediaPlaying.isPaused).toBe(false);
    expect(load).toHaveBeenLastCalledWith(
      expect.objectContaining({ autoplay: true }),
    );
  });

  it("keeps the translated task in sync when AI updates its VTT", () => {
    const sourceCaption = createCaption("source-caption");
    const translatedCaption: Caption = {
      id: "source-caption-translated-en",
      language: "en",
      vttData: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOld",
      sourceCaption,
    };
    const alignedCaption: Caption = {
      ...translatedCaption,
      vttData: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOld",
      alignmentBaseVttData: translatedCaption.vttData,
      alignment: { offsetMs: -1000 },
    };

    usePlayerStore.setState((state) => {
      state.caption.selected = translatedCaption;
      state.caption.translateTask = {
        targetCaption: sourceCaption,
        targetLanguage: "en",
        translatedCaption,
        done: true,
        error: false,
        cancel: vi.fn(),
      };
    });

    usePlayerStore.getState().setCaption(alignedCaption);

    const state = usePlayerStore.getState();
    expect(state.caption.selected).toEqual(alignedCaption);
    expect(state.caption.translateTask?.translatedCaption).toEqual(
      alignedCaption,
    );
  });

  it("resets captions, time, and unloads display when switching to a new episode", () => {
    const load = vi.fn();
    const setCaption = vi.fn();
    const display = {
      load,
      destroy: vi.fn(),
      getType: () => "web",
      on: vi.fn(),
      setCaption,
      setSecondaryCaption: vi.fn(),
    } as unknown as DisplayInterface;
    usePlayerStore.getState().setDisplay(display);

    const store = usePlayerStore.getState();
    store.setMeta(createMeta(1));
    store.setSource(createSource("source-1"), [], 0);
    usePlayerStore.setState((s) => {
      s.caption.selected = {
        id: "caption-1",
        language: "en",
        vttData: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello",
      };
      s.progress.time = 45;
      s.progress.duration = 1200;
      s.mediaPlaying.hasRenderedFrame = true;
    });

    // User or autoplay triggers next episode
    store.setMeta(createMeta(2), "sourceSelection");

    const state = usePlayerStore.getState();
    expect(state.status).toBe("sourceSelection");
    expect(state.caption.selected).toBeNull();
    expect(state.progress.time).toBe(0);
    expect(state.progress.duration).toBe(0);
    expect(state.mediaPlaying.hasRenderedFrame).toBe(false);
    expect(state.source).toBeNull();
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({ source: null, reason: "store:set-meta" }),
    );
    expect(setCaption).toHaveBeenCalledWith(null);
  });
});
