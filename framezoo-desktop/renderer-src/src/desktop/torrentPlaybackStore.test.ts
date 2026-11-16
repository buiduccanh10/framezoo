import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearTorrentSession,
  getActiveTorrentStatus,
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

  it("stops displaced sessions during rapid replacement and supports explicit stop by id", async () => {
    torrentClientMocks.getTorrentStatus.mockResolvedValue(null);

    registerTorrentSession("session-1");
    registerTorrentSession("session-2");
    registerTorrentSession("session-3");

    await stopTorrentSession("session-1");
    expect(torrentClientMocks.stopTorrent).toHaveBeenCalledTimes(1);
    expect(torrentClientMocks.stopTorrent).toHaveBeenCalledWith("session-1");

    await vi.advanceTimersByTimeAsync(15_000);
    expect(torrentClientMocks.stopTorrent).toHaveBeenCalledWith("session-2");
    expect(torrentClientMocks.stopTorrent).toHaveBeenCalledTimes(2);

    await stopTorrentSession();
    expect(torrentClientMocks.stopTorrent).toHaveBeenCalledWith("session-3");
    expect(torrentClientMocks.stopTorrent).toHaveBeenCalledTimes(3);
  });

  it("delivers streamType file immediately even inside 500ms progress throttle window", async () => {
    torrentClientMocks.getTorrentStatus.mockResolvedValue(null);
    registerTorrentSession("session-1");
    const waiting = waitForTorrentPlayable("session-1");

    emitStatus(
      createStatus({
        state: "downloading",
        progress: 0.01,
        updatedAt: 100,
      }),
    );
    // Another downloading tick within 500ms gets throttled, then urgent "file" arrives
    emitStatus(
      createStatus({
        state: "downloading",
        progress: 0.02,
        updatedAt: 150,
      }),
    );
    const playable = createStatus({
      state: "downloading",
      streamType: "file",
      streamUrl: "http://127.0.0.1:4567/torrent/session-1",
      progress: 0.05,
      updatedAt: 200,
    });
    emitStatus(playable);

    await expect(waiting).resolves.toEqual(playable);

    // Flushing the delayed throttle timer must not overwrite with stale "pending"
    vi.advanceTimersByTime(600);
    expect(getActiveTorrentStatus()).toEqual(playable);
  });
});
