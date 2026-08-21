import { describe, expect, it } from "vitest";

import { normalizeManifest } from "./manifest";
import {
  findAddonStreamPreference,
  getAddonStreamQuality,
  getAddonStreamQueryKey,
  loadAllAddonStreamsDetailed,
  matchesAddonStreamPreference,
  normalizeAddonStreams,
} from "./streams";

const addon = normalizeManifest("https://example.com/manifest.json", {
  id: "com.example.addon",
  version: "1.0.0",
  name: "Example",
  resources: ["stream"],
});

describe("addon stream normalization", () => {
  it("classifies torrent, HLS, and direct file streams", () => {
    const streams = normalizeAddonStreams(addon, [
      {
        title: "Torrent",
        url: "magnet:?xt=urn:btih:ABCDEF",
        fileIdx: 2,
      },
      {
        name: "Torrentio",
        title: "Torrentio metadata-only stream",
        infoHash: "0123456789abcdef0123456789abcdef01234567",
        fileIdx: 1,
        behaviorHints: {
          filename: "movie.mkv",
        },
      },
      {
        title: "HLS",
        url: "https://cdn.example.com/video.m3u8",
      },
      {
        title: "File",
        url: "https://cdn.example.com/video.mp4",
      },
    ]);

    expect(streams.map((stream) => stream.kind)).toEqual([
      "torrent",
      "torrent",
      "hls",
      "file",
    ]);
    expect(streams[0].infoHash).toBe("abcdef");
    expect(streams[0].fileIdx).toBe(2);
    expect(streams[1].url).toBe(
      "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
    );
    expect(streams[1].fileName).toBe("movie.mkv");
  });

  it("preserves Peerflix description when title is omitted", () => {
    const [stream] = normalizeAddonStreams(addon, [
      {
        name: "Peerflix 🇪🇸 720p",
        description:
          "Reacher - Temporada 1 [HDTV 720p][Cap.101]\n" +
          "Reacher - Temporada 1 [HDTV 720p][Cap.101].mkv\n" +
          "👤 2 💾 1.52 GB 🌐 Peerflix",
        infoHash: "peerflix-hash",
        fileIdx: 2,
      },
    ]);

    expect(stream).toMatchObject({
      name: "Peerflix 🇪🇸 720p",
      title: "",
      description:
        "Reacher - Temporada 1 [HDTV 720p][Cap.101]\n" +
        "Reacher - Temporada 1 [HDTV 720p][Cap.101].mkv\n" +
        "👤 2 💾 1.52 GB 🌐 Peerflix",
    });
  });

  it("matches the same addon stream preference across episodes by binge group", () => {
    const [selectedStream] = normalizeAddonStreams(addon, [
      {
        name: "1080p",
        title: "Show S01E01 Release",
        url: "magnet:?xt=urn:btih:episode-one",
        behaviorHints: {
          bingeGroup: "example-1080p",
        },
      },
    ]);
    const [nextEpisodeStream] = normalizeAddonStreams(addon, [
      {
        name: "1080p",
        title: "Show S01E02 Release",
        url: "magnet:?xt=urn:btih:episode-two",
        behaviorHints: {
          bingeGroup: "example-1080p",
        },
      },
    ]);

    expect(getAddonStreamQuality(selectedStream)).toBe("1080p");
    expect(
      matchesAddonStreamPreference(nextEpisodeStream, {
        addonId: addon.manifest.id,
        sourceKind: "torrent",
        quality: "1080p",
        name: selectedStream.name,
        title: selectedStream.title,
        bingeGroup: selectedStream.bingeGroup,
      }),
    ).toBe(true);
    expect(
      matchesAddonStreamPreference(nextEpisodeStream, {
        addonId: addon.manifest.id,
        sourceKind: "torrent",
        quality: "1080p",
        name: selectedStream.name,
        title: selectedStream.title,
        bingeGroup: "other-group",
      }),
    ).toBe(false);
  });

  it("keeps the same addon and quality when episode metadata rotates", () => {
    const [selectedStream] = normalizeAddonStreams(addon, [
      {
        name: "Torrentio",
        title: "Dexter S02E07 1080p BluRay",
        url: "magnet:?xt=urn:btih:episode-seven",
        behaviorHints: {
          bingeGroup: "torrentio-1080p",
        },
      },
    ]);
    const [nextEpisodeStream, otherQualityStream] = normalizeAddonStreams(
      addon,
      [
        {
          name: "Torrentio",
          title: "Dexter S02E08 1080p BluRay",
          url: "magnet:?xt=urn:btih:episode-eight",
          behaviorHints: {
            bingeGroup: "rotated-1080p",
          },
        },
        {
          name: "Torrentio",
          title: "Dexter S02E08 4K BluRay",
          url: "magnet:?xt=urn:btih:episode-eight-4k",
          behaviorHints: {
            bingeGroup: "rotated-4k",
          },
        },
      ],
    );

    expect(
      findAddonStreamPreference([otherQualityStream, nextEpisodeStream], {
        addonId: addon.manifest.id,
        sourceKind: "torrent",
        quality: "1080p",
        name: selectedStream.name,
        title: selectedStream.title,
        bingeGroup: selectedStream.bingeGroup,
      }),
    ).toBe(nextEpisodeStream);
  });
});

describe("addon stream loading", () => {
  it("isolates movie and episode results in separate query keys", () => {
    const movieKey = getAddonStreamQueryKey(addon, {
      type: "movie",
      id: "tt1234567",
    });
    const episodeKey = getAddonStreamQueryKey(addon, {
      type: "series",
      id: "tt1234567",
      season: 1,
      episode: 2,
    });

    expect(movieKey).not.toEqual(episodeKey);
    expect(movieKey[0]).toBe("addon-streams");
    expect(episodeKey.slice(-3)).toEqual(["tt1234567", 1, 2]);
  });

  it("keeps successful streams and reports failed addons", async () => {
    const workingAddon = normalizeManifest(
      "https://working.example/manifest.json",
      {
        id: "com.example.working",
        version: "1.0.0",
        name: "Working",
        resources: ["stream"],
      },
    );
    const failingAddon = normalizeManifest(
      "https://failing.example/manifest.json",
      {
        id: "com.example.failing",
        version: "1.0.0",
        name: "Failing",
        resources: ["stream"],
      },
    );

    const result = await loadAllAddonStreamsDetailed(
      [workingAddon, failingAddon],
      { type: "movie", id: "tt1234567" },
      async (candidateAddon) => {
        if (candidateAddon.manifest.id === failingAddon.manifest.id) {
          throw new Error("HTTP 502");
        }
        return [{ infoHash: "0123456789abcdef" }];
      },
    );

    expect(result.streams).toHaveLength(1);
    expect(result.streams[0]?.addonId).toBe(workingAddon.manifest.id);
    expect(result.errors).toEqual([
      {
        addonId: failingAddon.manifest.id,
        addonName: failingAddon.manifest.name,
        url: failingAddon.manifestUrl,
        message: "HTTP 502",
      },
    ]);
  });
});
