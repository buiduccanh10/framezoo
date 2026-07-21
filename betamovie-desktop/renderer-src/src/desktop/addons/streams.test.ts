import { describe, expect, it } from "vitest";

import { normalizeManifest } from "./manifest";
import { loadAllAddonStreamsDetailed, normalizeAddonStreams } from "./streams";

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
});

describe("addon stream loading", () => {
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
