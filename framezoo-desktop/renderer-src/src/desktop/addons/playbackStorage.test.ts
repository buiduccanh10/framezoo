import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerMeta } from "@/stores/player/slices/source";

import {
  clearAllPlaybackStorage,
  clearLastTorrentSelection,
  clearMediaPlaybackStorage,
  getLastStreamPreference,
  getLastTorrentSelection,
  getPlaybackSelectionKey,
  matchesSavedTorrentSelection,
  saveLastStreamPreference,
  saveLastTorrentSelection,
} from "./playbackStorage";
import type { AddonStream } from "./types";

const movieMeta: PlayerMeta = {
  type: "movie",
  title: "Movie",
  tmdbId: "10",
  releaseYear: 2026,
};

const episodeMeta: PlayerMeta = {
  type: "show",
  title: "Show",
  tmdbId: "20",
  releaseYear: 2026,
  season: {
    number: 1,
    title: "Season 1",
    tmdbId: "30",
  },
  episode: {
    number: 2,
    title: "Episode 2",
    tmdbId: "40",
  },
};

const nextEpisodeMeta: PlayerMeta = {
  ...episodeMeta,
  episode: {
    number: 3,
    title: "Episode 3",
    tmdbId: "41",
  },
};

function makeTorrent(overrides: Partial<AddonStream> = {}): AddonStream {
  return {
    id: "addon:0:hash",
    addonId: "addon.example",
    addonName: "Addon",
    kind: "torrent",
    name: "1080p",
    title: "Movie",
    description: "",
    url: "magnet:?xt=urn:btih:hash",
    infoHash: "hash",
    fileIdx: 1,
    fileName: "movie.mkv",
    videoSize: null,
    subtitles: [],
    ...overrides,
  };
}

describe("addon playback storage", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses separate keys for movies and episodes", () => {
    expect(getPlaybackSelectionKey(movieMeta)).toBe("movie:10");
    expect(getPlaybackSelectionKey(episodeMeta)).toBe("show:20:30:40");
  });

  it("saves and restores the last torrent for a media item", () => {
    const stream = makeTorrent();

    saveLastTorrentSelection(episodeMeta, stream);

    expect(getLastTorrentSelection(episodeMeta)).toMatchObject({
      addonId: "addon.example",
      infoHash: "hash",
      fileIdx: 1,
      fileName: "movie.mkv",
    });
    expect(getLastTorrentSelection(movieMeta)).toBeNull();
  });

  it("stores the selected addon preference at series scope", () => {
    saveLastStreamPreference(episodeMeta, makeTorrent(), "1080p");

    expect(getLastStreamPreference(nextEpisodeMeta)).toMatchObject({
      seriesId: "20",
      addonId: "addon.example",
      sourceKind: "torrent",
      quality: "1080p",
    });
  });

  it("matches the same torrent file and rejects a changed torrent", () => {
    saveLastTorrentSelection(episodeMeta, makeTorrent());
    const saved = getLastTorrentSelection(episodeMeta);
    if (!saved) throw new Error("Expected saved torrent selection");

    expect(matchesSavedTorrentSelection(saved, makeTorrent())).toBe(true);
    expect(
      matchesSavedTorrentSelection(
        saved,
        makeTorrent({ infoHash: "different-hash" }),
      ),
    ).toBe(false);
    expect(
      matchesSavedTorrentSelection(saved, makeTorrent({ fileIdx: 2 })),
    ).toBe(false);
  });

  it("falls back to the file name when only one stream has a file index", () => {
    saveLastTorrentSelection(episodeMeta, makeTorrent());
    const saved = getLastTorrentSelection(episodeMeta);
    if (!saved) throw new Error("Expected saved torrent selection");

    expect(
      matchesSavedTorrentSelection(
        saved,
        makeTorrent({ fileIdx: null, fileName: "movie.mkv" }),
      ),
    ).toBe(true);
    expect(
      matchesSavedTorrentSelection(
        saved,
        makeTorrent({ fileIdx: null, fileName: "other.mkv" }),
      ),
    ).toBe(false);
  });

  it("clears the saved torrent when the media switches source", () => {
    saveLastTorrentSelection(movieMeta, makeTorrent());
    clearLastTorrentSelection(movieMeta);

    expect(getLastTorrentSelection(movieMeta)).toBeNull();
  });

  it("clears all torrent selections and series preferences for a given tmdbId", () => {
    saveLastTorrentSelection(movieMeta, makeTorrent());
    saveLastTorrentSelection(episodeMeta, makeTorrent());
    saveLastTorrentSelection(nextEpisodeMeta, makeTorrent());
    saveLastStreamPreference(episodeMeta, makeTorrent(), "1080p");

    clearMediaPlaybackStorage("20");

    expect(getLastTorrentSelection(episodeMeta)).toBeNull();
    expect(getLastTorrentSelection(nextEpisodeMeta)).toBeNull();
    expect(getLastStreamPreference(episodeMeta)).toBeNull();
    expect(getLastTorrentSelection(movieMeta)).not.toBeNull();
  });

  it("clears all playback storage completely", () => {
    saveLastTorrentSelection(movieMeta, makeTorrent());
    saveLastStreamPreference(episodeMeta, makeTorrent(), "1080p");

    clearAllPlaybackStorage();

    expect(getLastTorrentSelection(movieMeta)).toBeNull();
    expect(getLastStreamPreference(episodeMeta)).toBeNull();
  });
});

