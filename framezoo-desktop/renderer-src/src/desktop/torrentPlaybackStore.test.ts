import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearTorrentSession,
  registerTorrentSession,
  stopTorrentSession,
  waitForTorrentPlayable,
} from "./torrentPlaybackStore";
import type { TorrentStatus } from "./torrentTypes";

const torrentClientMocks = vi.hoisted(() => ({
  getTorrentStatus: vi.fn(),
  stopTorrent: vi.fn(),
  listeners: new Set<(status: TorrentStatus) => void>(),
}));

vi.mock("./torrentClient", () => ({
  getTorrentStatus: torrentClientMocks.getTorrentStatus,
  stopTorrent: torrentClientMocks.stopTorrent,
  subscribeTorrentStatus: (listener: (status: TorrentStatus) => void) => {
    torrentClientMocks.listeners.add(listener);
    return () => torrentClientMocks.listeners.delete(listener);
  },
}));

function createStatus(overrides: Partial<TorrentStatus> = {}): TorrentStatus {
  return {
    sessionId: "session-1",
    sourceId: "source-1",
    state: "buffering",
    progress: 0,
    speedBytesPerSecond: 0,
    peers: 0,
    infoHash: "hash",
    fileName: "episode.mkv",
    downloadedBytes: 0,
    totalBytes: 100,
    streamType: "pending",
    streamUrl: "http://127.0.0.1/torrent/session-1",
    error: null,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function emitStatus(status: TorrentStatus) {
  for (const listener of torrentClientMocks.listeners) listener(status);
}

describe("torrent playback wait lifecycle", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    torrentClientMocks.getTorrentStatus.mockReset();
    torrentClientMocks.stopTorrent.mockReset();
    torrentClientMocks.stopTorrent.mockResolvedValue(true);
    torrentClientMocks.listeners.clear();
    await clearTorrentSession();
    vi.runOnlyPendingTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("keeps waiting with zero peers until the torrent becomes playable", async () => {
    const pendingStatus = createStatus();
    torrentClientMocks.getTorrentStatus.mockResolvedValue(pendingStatus);

    registerTorrentSession("session-1");
    const playable = waitForTorrentPlayable("session-1");

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    const playableStatus = createStatus({
      state: "downloading",
      peers: 1,
      streamType: "file",
      streamUrl: "http://127.0.0.1/torrent/session-1",
    });
    emitStatus(playableStatus);

    await expect(playable).resolves.toEqual(playableStatus);
  });

  it("rejects when the active torrent session is replaced", async () => {
    const pendingStatus = createStatus();
    torrentClientMocks.getTorrentStatus.mockResolvedValue(pendingStatus);

    registerTorrentSession("session-1");
    const waiting = waitForTorrentPlayable("session-1");
    await clearTorrentSession();

    await expect(waiting).rejects.toThrow("Torrent session was replaced");
  });

  it("stops the active torrent immediately and cancels its grace timer", async () => {
    torrentClientMocks.getTorrentStatus.mockResolvedValue(null);
    registerTorrentSession("session-1");
    await clearTorrentSession();
    await stopTorrentSession();

    expect(torrentClientMocks.stopTorrent).toHaveBeenCalledTimes(1);
    expect(torrentClientMocks.stopTorrent).toHaveBeenCalledWith("session-1");

    vi.advanceTimersByTime(10_000);
    expect(torrentClientMocks.stopTorrent).toHaveBeenCalledTimes(1);
  });
});
