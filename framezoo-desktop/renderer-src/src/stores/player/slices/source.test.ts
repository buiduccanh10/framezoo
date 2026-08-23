import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DisplayInterface } from "@/components/player/display/displayInterface";
import { queryClient } from "@/utils/queryClient";

import { usePlayerStore } from "../store";
import type { Caption, CaptionListItem, PlayerMeta } from "./source";
import type { SourceSliceSource } from "../utils/qualities";

const subtitleMocks = vi.hoisted(() => ({
  loadAll: vi.fn(),
}));

vi.mock("@/desktop/addons/subtitles", () => ({
  loadAllAddonSubtitles: subtitleMocks.loadAll,
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
    queryClient.clear();
    usePlayerStore.getState().reset();
    subtitleMocks.loadAll.mockResolvedValue({
      captions: [],
      errors: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deduplicates in-flight subtitle requests for the same episode", async () => {
    let resolveScrape:
      | ((res: { captions: CaptionListItem[]; errors: any[] }) => void)
      | undefined;
    subtitleMocks.loadAll.mockReturnValueOnce(
      new Promise<{ captions: CaptionListItem[]; errors: any[] }>((resolve) => {
        resolveScrape = resolve;
      }),
    );

    const store = usePlayerStore.getState();

    store.setMeta(createMeta(5));
    store.setSource(createSource("source-a"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    store.setSource(createSource("source-b"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    expect(subtitleMocks.loadAll).toHaveBeenCalledTimes(1);

    const caption = createCaption("episode-5-vietnamese");
    resolveScrape?.({ captions: [caption], errors: [] });
    await vi.runAllTimersAsync();

    expect(usePlayerStore.getState().captionList).toContainEqual(caption);
  });

  it("uses the React Query cache without scraping again", async () => {
    const caption = createCaption("episode-5-vietnamese");
    subtitleMocks.loadAll.mockResolvedValueOnce({
      captions: [caption],
      errors: [],
    });

    const store = usePlayerStore.getState();
    store.setMeta(createMeta(5));
    store.setSource(createSource("source-a"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    expect(subtitleMocks.loadAll).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().captionList).toContainEqual(caption);

    usePlayerStore.getState().reset();
    usePlayerStore.getState().setMeta(createMeta(5));
    usePlayerStore.getState().setSource(createSource("source-b"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    expect(subtitleMocks.loadAll).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().captionList).toContainEqual(caption);
  });

  it("clears the old cache and replaces external captions on force refresh", async () => {
    const oldCaption = createCaption("episode-5-old");
    const newCaption = createCaption("episode-5-new");
    subtitleMocks.loadAll
      .mockResolvedValueOnce({ captions: [oldCaption], errors: [] })
      .mockResolvedValueOnce({ captions: [newCaption], errors: [] });

    const store = usePlayerStore.getState();
    store.setMeta(createMeta(5));
    store.setSource(createSource("source-a"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    expect(usePlayerStore.getState().captionList).toContainEqual(oldCaption);

    await usePlayerStore
      .getState()
      .addExternalSubtitles(undefined, { forceRefresh: true });

    const state = usePlayerStore.getState();
    expect(subtitleMocks.loadAll).toHaveBeenCalledTimes(2);
    expect(state.captionList).not.toContainEqual(oldCaption);
    expect(state.captionList).toContainEqual(newCaption);
    const cachedQueries = queryClient
      .getQueryCache()
      .findAll({ queryKey: ["externalSubtitles"] });
    expect(cachedQueries).toHaveLength(1);
    expect(cachedQueries[0]?.state.data).toEqual([newCaption]);
  });

  it("rejects a late caption response from the previous episode", async () => {
    let resolveEpisode4:
      | ((res: { captions: CaptionListItem[]; errors: any[] }) => void)
      | undefined;
    subtitleMocks.loadAll.mockImplementationOnce(
      () =>
        new Promise<{ captions: CaptionListItem[]; errors: any[] }>(
          (resolve) => {
            resolveEpisode4 = resolve;
          },
        ),
    );

    const store = usePlayerStore.getState();

    store.setMeta(createMeta(4));
    store.setSource(createSource("source-a"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    store.setMeta(createMeta(5));
    store.setSource(createSource("source-b"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    const oldEpisodeCaption = createCaption("episode-4-vietnamese");
    resolveEpisode4?.({ captions: [oldEpisodeCaption], errors: [] });
    await vi.runAllTimersAsync();

    expect(usePlayerStore.getState().captionList).not.toContainEqual(
      oldEpisodeCaption,
    );
  });

  it("streams incremental captions from onProgress callback into captionList", async () => {
    let progressCallback: ((update: any) => void) | undefined;
    subtitleMocks.loadAll.mockImplementationOnce(
      (_addons, _type, _id, onProgress) => {
        progressCallback = onProgress;
        return new Promise<{ captions: CaptionListItem[]; errors: any[] }>(
          () => {},
        );
      },
    );

    const store = usePlayerStore.getState();
    store.setMeta(createMeta(1));
    store.setSource(createSource("source-1"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    const caption1 = createCaption("sub-addon-1");
    progressCallback?.({
      captions: [caption1],
      completed: 1,
      total: 2,
    });

    expect(usePlayerStore.getState().captionList).toContainEqual(caption1);
    expect(usePlayerStore.getState().externalSubtitleLoadProgress).toEqual({
      completed: 1,
      total: 2,
    });
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

  it("retains external subtitles when stream promotion occurs within the same episode", async () => {
    let resolveScrape:
      | ((res: { captions: CaptionListItem[]; errors: any[] }) => void)
      | undefined;
    subtitleMocks.loadAll.mockImplementationOnce(
      () =>
        new Promise<{ captions: CaptionListItem[]; errors: any[] }>(
          (resolve) => {
            resolveScrape = resolve;
          },
        ),
    );

    const store = usePlayerStore.getState();
    store.setMeta(createMeta(1));

    // Initial pending stream
    store.setSource(createSource("pending-torrent"), [], 0);
    await vi.advanceTimersByTimeAsync(50);

    // Promoted torrent stream for the same episode before scraping finishes
    store.setSource(createSource("promoted-torrent"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    const caption = createCaption("episode-1-vietnamese");
    resolveScrape?.({ captions: [caption], errors: [] });
    await vi.runAllTimersAsync();

    expect(usePlayerStore.getState().captionList).toContainEqual(caption);
  });

  it("formats addon query ID with tmdb: prefix when imdbId is absent", async () => {
    const metaWithoutImdb: PlayerMeta = {
      type: "show",
      title: "Anime Show",
      tmdbId: "85937",
      releaseYear: 2019,
      season: {
        number: 1,
        tmdbId: "season-1",
        title: "Season 1",
      },
      episode: {
        number: 3,
        tmdbId: "episode-3",
        title: "Episode 3",
      },
    };

    const store = usePlayerStore.getState();
    store.setMeta(metaWithoutImdb);
    store.setSource(createSource("source-1"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    expect(subtitleMocks.loadAll).toHaveBeenCalledWith(
      expect.anything(),
      "series",
      "tmdb:85937:1:3",
      expect.anything(),
    );
  });

  it("automatically fetches addon subtitles when switching to next episode", async () => {
    const captionEp1 = createCaption("episode-1-sub");
    const captionEp2 = createCaption("episode-2-sub");
    subtitleMocks.loadAll
      .mockResolvedValueOnce({ captions: [captionEp1], errors: [] })
      .mockResolvedValueOnce({ captions: [captionEp2], errors: [] });

    const store = usePlayerStore.getState();

    // Play episode 1
    store.setMeta(createMeta(1));
    store.setSource(createSource("source-ep1"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    expect(usePlayerStore.getState().captionList).toContainEqual(captionEp1);

    // Switch to episode 2
    store.setMeta(createMeta(2), "sourceSelection");
    store.setSource(createSource("source-ep2"), [], 0);
    await vi.advanceTimersByTimeAsync(100);

    expect(subtitleMocks.loadAll).toHaveBeenCalledTimes(2);
    expect(usePlayerStore.getState().captionList).not.toContainEqual(
      captionEp1,
    );
    expect(usePlayerStore.getState().captionList).toContainEqual(captionEp2);
  });
});
