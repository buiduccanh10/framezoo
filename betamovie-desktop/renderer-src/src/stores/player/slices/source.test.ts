import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "../store";
import type { CaptionListItem, PlayerMeta } from "./source";
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
});
