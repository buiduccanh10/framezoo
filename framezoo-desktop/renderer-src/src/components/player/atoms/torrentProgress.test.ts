import { describe, expect, it } from "vitest";

import { getTorrentPreloadedProgress } from "./torrentProgress";

describe("torrent preload progress", () => {
  it("uses torrent download progress when it is ahead of playback buffering", () => {
    expect(getTorrentPreloadedProgress(20, 100, 70)).toBe(0.7);
  });

  it("keeps the browser buffered progress when it is ahead of torrent progress", () => {
    expect(getTorrentPreloadedProgress(30, 100, 10)).toBe(0.3);
  });

  it("clamps invalid or out-of-range values", () => {
    expect(getTorrentPreloadedProgress(Number.NaN, 0, 120)).toBe(0);
    expect(getTorrentPreloadedProgress(200, 100, -10)).toBe(1);
  });
});
