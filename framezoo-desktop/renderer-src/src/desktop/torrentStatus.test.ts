import { describe, expect, it } from "vitest";

import {
  acceptsTorrentStatus,
  mergeTorrentStatus,
  normalizeTorrentProgress,
} from "./torrentStatus";
import type { TorrentStatus } from "./torrentTypes";

const status = (sessionId: string, progress: number): TorrentStatus => ({
  sessionId,
  sourceId: "source",
  state: "downloading",
  progress,
  speedBytesPerSecond: 10,
  peers: 2,
  infoHash: "abc",
  fileName: "video.mp4",
  downloadedBytes: 10,
  totalBytes: 100,
  streamUrl: "http://127.0.0.1/video",
  error: null,
  updatedAt: Date.now(),
});

describe("torrent status lifecycle", () => {
  it("ignores stale events from another session", () => {
    const current = status("current", 40);
    expect(acceptsTorrentStatus("current", status("stale", 90))).toBe(false);
    expect(mergeTorrentStatus(current, status("stale", 90))).toBe(current);
  });

  it("clamps progress to a valid UI range", () => {
    expect(normalizeTorrentProgress(-1)).toBe(0);
    expect(normalizeTorrentProgress(101)).toBe(100);
    expect(
      mergeTorrentStatus(status("current", 40), status("current", 101))
        ?.progress,
    ).toBe(100);
  });
});
