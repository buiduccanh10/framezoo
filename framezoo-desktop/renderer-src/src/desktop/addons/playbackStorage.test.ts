import { afterEach, describe, expect, it } from "vitest";

import type { PlayerMeta } from "@/stores/player/slices/source";

import {
  clearLastTorrentSelection,
  getLastTorrentSelection,
  getPlaybackSelectionKey,
  matchesSavedTorrentSelection,
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
  afterEach(() => {
    localStorage.clear();
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
});
