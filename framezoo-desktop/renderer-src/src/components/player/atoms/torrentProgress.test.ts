import { describe, expect, it } from "vitest";

import { getTorrentPreloadedProgress } from "./torrentProgress";

describe("torrent preload progress", () => {
  it("ignores overall torrent progress to avoid confusing users with non-sequential buffer representations", () => {
    expect(getTorrentPreloadedProgress(20, 100, 70)).toBe(0.2);
  });

  it("always uses the browser buffered progress", () => {
    expect(getTorrentPreloadedProgress(30, 100, 10)).toBe(0.3);
  });

  it("clamps invalid or out-of-range values", () => {
    expect(getTorrentPreloadedProgress(Number.NaN, 0, 120)).toBe(0);
    expect(getTorrentPreloadedProgress(200, 100, -10)).toBe(1);
  });
});
