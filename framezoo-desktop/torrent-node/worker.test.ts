import { createHash } from "node:crypto";
import { Agent, request as httpRequest } from "node:http";
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { TorrentMetadata } from "torrent-stream";
import { describe, expect, it } from "vitest";

import { REQUEST_BLOCK_BYTES, VirtualCache } from "./virtualCache";
import {
  TorrentRecord,
  TorrentWorker,
  computePrefetchEnd,
  computeSyncTargetBlockRanges,
  computeWireTargetQueue,
  enforceCacheLimit,
  isPrefetchSeek,
  shouldHotswapBlock,
} from "./worker";

describe("wire BDP scheduler helpers", () => {
  it("sizes per-wire request pipeline cleanly from untested -> slow -> fast BDP", () => {
    // Untested peer gets a small probe queue of 4 blocks.
    expect(computeWireTargetQueue(0, 0, 80, 1.2)).toBe(4);
    // Slow peer (< 48 KiB/s) stays capped at 2 blocks.
    expect(computeWireTargetQueue(5, 16 * 1024, 80, 1.2)).toBe(2);
    // Healthy peer scales linearly with speed * bdpSeconds, clamped to [8 .. maxQueuePerWire].
    expect(computeWireTargetQueue(5, 100 * 1024, 80, 1.2)).toBe(8);
    expect(computeWireTargetQueue(10, 800 * 1024, 80, 1.2)).toBe(60);
    expect(computeWireTargetQueue(50, 4_000 * 1024, 80, 1.2)).toBe(80);
  });

  it("only hotswaps urgent blocks on genuine wire stalls or >=2x faster takeover", () => {
    const now = 10_000;
    // Active fast seeder with deep queue: owner got data 200ms ago, req sent 700ms ago -> DO NOT cancel!
    expect(shouldHotswapBlock(now, now - 700, now - 200, 1_000_000, 1_200_000)).toBe(
      false,
    );
    // Owner went silent > 1200ms -> hotswap even if candidate speed is modest.
    expect(shouldHotswapBlock(now, now - 1_500, now - 1_300, 200_000, 50_000)).toBe(
      true,
    );
    // Slow owner (20 KB/s) held block > 350ms while fast candidate (300 KB/s >= 120 KB/s) is idle -> takeover.
    expect(shouldHotswapBlock(now, now - 400, now - 400, 20_000, 300_000)).toBe(
      true,
    );
    // Below 350ms age -> let owner finish first.
    expect(shouldHotswapBlock(now, now - 200, now - 200, 20_000, 500_000)).toBe(
      false,
    );
  });
});

describe("prefetch helpers", () => {
  it("downloads continuously to EOF unless cache is disabled, low disk, or reached maxBytes", () => {
    expect(computePrefetchEnd(10, 500, 64, null, 1_000_000_000)).toBe(500);
    expect(computePrefetchEnd(10, 500, 64, null, 0, true)).toBe(73);
    expect(computePrefetchEnd(10, 500, 64, 2_000_000, 1_000_000)).toBe(500);
    expect(computePrefetchEnd(10, 500, 64, 2_000_000, 2_000_000)).toBe(73);
    expect(computePrefetchEnd(10, 500, 64, 0, 0)).toBe(73);
  });

  it("treats sequential advance and in-frontier reads as continuous, and out-of-range as seek", () => {
    expect(isPrefetchSeek(true, 15, 10, 80)).toBe(false);
    expect(isPrefetchSeek(true, 82, 10, 80)).toBe(false);
    expect(isPrefetchSeek(true, 9, 10, 80)).toBe(true);
    expect(isPrefetchSeek(true, 83, 10, 80)).toBe(true);
    expect(isPrefetchSeek(false, 15, 10, 80)).toBe(true);
  });
});

describe("cache limit and worker lifecycle", () => {
  it("evicts oldest inactive torrent directories when exceeding maxBytes or free-disk threshold", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "framezoo-worker-prune-"));
    const oldDir = path.join(root, "framezoo-node-torrent-old111");
    const newDir = path.join(root, "framezoo-node-torrent-new222");
    const activeDir = path.join(root, "framezoo-node-torrent-act333");
    try {
      await mkdir(oldDir, { recursive: true });
      await mkdir(newDir, { recursive: true });
      await mkdir(activeDir, { recursive: true });
      await writeFile(path.join(oldDir, "seg-0.bin"), Buffer.alloc(64 * 1024, 1));
      await writeFile(path.join(newDir, "seg-0.bin"), Buffer.alloc(64 * 1024, 2));
      await writeFile(path.join(activeDir, "seg-0.bin"), Buffer.alloc(64 * 1024, 3));
      const now = Date.now() / 1000;
      await utimes(oldDir, now - 300, now - 300);
      await utimes(newDir, now - 100, now - 100);
      await utimes(activeDir, now - 50, now - 50);

      await enforceCacheLimit(root, 128 * 1024, new Set([activeDir]), 0);
      await expect(access(oldDir)).rejects.toThrow();
      await expect(access(newDir)).resolves.toBeUndefined();
      await expect(access(activeDir)).resolves.toBeUndefined();

      // Free-disk guard (set higher than any drive free space) evicts remaining inactive dir even when maxBytes=null.
      await enforceCacheLimit(root, null, new Set([activeDir]), Number.MAX_SAFE_INTEGER);
      await expect(access(newDir)).rejects.toThrow();
      await expect(access(activeDir)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("aborts pending HTTP streams on stop() and closes keep-alive sockets on dispose()", async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), "framezoo-worker-stop-"));
    const worker = new TorrentWorker();
    const agent = new Agent({ keepAlive: true });
    try {
      await worker.startServer();
      const session = await worker.start(
        {
          sourceId: "src-1",
          url: "magnet:?xt=urn:btih:0123456789012345678901234567890123456789",
          maxBytes: 0,
          cacheRoot,
        },
        "sess-stop-test",
      );

      const streamClosed = new Promise<void>((resolve) => {
        const req = httpRequest(session.streamUrl, { agent }, (res) => {
          res.once("close", resolve);
          res.once("error", () => resolve());
        });
        req.once("close", resolve);
        req.once("error", () => resolve());
        req.end();
      });

      await new Promise((resolve) => setTimeout(resolve, 40));
      await worker.stop("sess-stop-test", true);
      await Promise.race([
        streamClosed,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("HTTP stream did not abort on stop()")), 2_000),
        ),
      ]);
      expect(worker.getStatus("sess-stop-test")).toBeNull();

      // Open a keep-alive request and ensure dispose() finishes promptly without hanging.
      const keepAliveSession = await worker.start(
        {
          sourceId: "src-2",
          url: "magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98",
          maxBytes: 0,
          cacheRoot,
        },
        "sess-dispose-test",
      );
      const req2 = httpRequest(keepAliveSession.streamUrl, { agent }, () => {});
      req2.on("error", () => {});
      req2.end();
      await new Promise((resolve) => setTimeout(resolve, 30));

      const started = Date.now();
      await worker.dispose();
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      agent.destroy();
      await worker.dispose().catch(() => {});
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });
});

describe("torrent sync focus mode", () => {
  it("computes prioritized header, footer, and estimated window block ranges", () => {
    // 100 MiB file, 1000s duration -> 100 KiB/s
    const fileLength = 100 * 1024 * 1024;
    const ranges = computeSyncTargetBlockRanges(
      0,
      fileLength,
      1000,
      [
        { startAt: 200, duration: 60 },
        { startAt: 600, duration: 60 },
      ],
      1024 * 1024, // 1 MiB edge = 64 blocks
    );

    expect(ranges.length).toBe(4);
    // Priority 0: header 1 MiB (blocks 0..63), Priority 1: footer 1 MiB
    expect(ranges[0]).toEqual({ startBlock: 0, endBlock: 63 });
    const lastBlock = Math.floor((fileLength - 1) / REQUEST_BLOCK_BYTES);
    expect(ranges[1]).toEqual({
      startBlock: lastBlock - 63,
      endBlock: lastBlock,
    });
    // Window ranges follow in order, strictly separated
    expect(ranges[2]!.startBlock).toBeGreaterThan(ranges[0]!.endBlock);
    expect(ranges[2]!.endBlock).toBeLessThan(ranges[3]!.startBlock);
    expect(ranges[3]!.endBlock).toBeLessThan(ranges[1]!.startBlock);

    // Without duration, still keeps header + footer pinned edges
    const edgesOnly = computeSyncTargetBlockRanges(
      0,
      fileLength,
      undefined,
      [{ startAt: 200, duration: 60 }],
      1024 * 1024,
    );
    expect(edgesOnly).toHaveLength(2);
    expect(computeSyncTargetBlockRanges(0, 0, 1000, [])).toEqual([]);
  });

  it("handles /sync-focus HTTP routes and keeps ?client=sync failures isolated", async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), "framezoo-sync-http-"));
    const worker = new TorrentWorker();
    try {
      await worker.startServer();
      const session = await worker.start(
        {
          sourceId: "src-sync",
          url: "magnet:?xt=urn:btih:1111111111111111111111111111111111111111",
          maxBytes: 0,
          cacheRoot,
        },
        "sess-sync-http",
      );

      // Untrusted Origin rejected
      const badOrigin = await fetch(`${session.streamUrl}/sync-focus`, {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ active: true }),
      });
      expect(badOrigin.status).toBe(403);

      // Packaged Electron app://renderer Origin allowed
      const appOrigin = await fetch(`${session.streamUrl}/sync-focus`, {
        method: "POST",
        headers: {
          Origin: "app://renderer",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          active: true,
          videoDuration: 3600,
          windows: [{ startAt: 60, duration: 60 }],
        }),
      });
      expect(appOrigin.status).toBe(200);
      expect(appOrigin.headers.get("access-control-allow-origin")).toBe(
        "app://renderer",
      );

      // Invalid JSON -> 400, oversized body -> 413, DELETE -> 200, missing -> 404
      const badJson = await fetch(`${session.streamUrl}/sync-focus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad",
      });
      expect(badJson.status).toBe(400);

      const tooBig = await fetch(`${session.streamUrl}/sync-focus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pad: "x".repeat(9000) }),
      });
      expect(tooBig.status).toBe(413);

      const delRes = await fetch(`${session.streamUrl}/sync-focus`, {
        method: "DELETE",
      });
      expect(delRes.status).toBe(200);

      const missingRes = await fetch(
        `${session.streamUrl.replace("sess-sync-http", "nope")}/sync-focus`,
        { method: "POST", body: '{"active":false}' },
      );
      expect(missingRes.status).toBe(404);

      // Simulate ?client=sync error by forcing fatal rejection on record via stop/missing metadata
      const syncStreamUrl = `${session.streamUrl}?client=sync`;
      const abortCtrl = new AbortController();
      const pendingSyncReq = fetch(syncStreamUrl, {
        signal: abortCtrl.signal,
      }).catch(() => null);
      await new Promise((r) => setTimeout(r, 30));
      abortCtrl.abort();
      await pendingSyncReq;
      expect(worker.getStatus("sess-sync-http")?.state).toBe("starting");
    } finally {
      await worker.dispose().catch(() => {});
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });

  it("dedicates peers to sync ranges, suspends normal reads, and resumes playback on exit", async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), "framezoo-sync-rec-"));
    const pieceLength = 512 * 1024;
    const totalBytes = 16 * 1024 * 1024; // 32 pieces = 1024 blocks
    const pieceCount = totalBytes / pieceLength;
    const dummyHash = createHash("sha1")
      .update(Buffer.alloc(pieceLength, 7))
      .digest("hex");
    const metadata: TorrentMetadata = {
      infoHash: "2222222222222222222222222222222222222222",
      length: totalBytes,
      pieceLength,
      pieces: Array.from({ length: pieceCount }, () => dummyHash),
      files: [{ name: "movie.mkv", path: "movie.mkv", offset: 0, length: totalBytes }],
    };

    const record = new TorrentRecord(
      {
        sourceId: "src-rec",
        url: "magnet:?xt=urn:btih:2222222222222222222222222222222222222222",
        maxBytes: 0,
        cacheRoot,
      },
      cacheRoot,
      () => {},
      async () => {},
      () => {},
    );

    try {
      record.metadata = metadata;
      const cache = new VirtualCache(path.join(cacheRoot, "vc"), metadata, undefined, {
        mode: "memory",
        memoryBudgetBytes: 64 * 1024 * 1024,
      });
      await cache.open();
      record.cache = cache;
      (record as unknown as { readyResolve: () => void }).readyResolve();

      const file = metadata.files[0]!;
      const requestedBlocks: number[] = [];
      const cancelledBlocks: number[] = [];

      const fakeWire = {
        peerChoking: false,
        amInterested: true,
        _finished: false,
        requests: [] as unknown[],
        peerPieces: Array.from({ length: pieceCount }, () => true),
        downloadSpeed: () => 500_000,
        interested: () => {},
        destroy: () => {},
        cancel: (piece: number, offset: number) => {
          cancelledBlocks.push(
            Math.floor((piece * pieceLength + offset) / REQUEST_BLOCK_BYTES),
          );
        },
        request: (
          piece: number,
          offset: number,
          len: number,
          cb: (err: Error | null, buf?: Buffer) => void,
        ) => {
          const bIdx = Math.floor(
            (piece * pieceLength + offset) / REQUEST_BLOCK_BYTES,
          );
          requestedBlocks.push(bIdx);
          // Complete sync reads asynchronously when asked
          queueMicrotask(() => cb(null, Buffer.alloc(len, 7)));
        },
      };
      (record.engine.swarm.wires as unknown[]).push(fakeWire);

      // Start normal playback around block 100 (without completing it)
      (
        record as unknown as {
          setPlaybackPosition: (f: typeof file, b: number) => void;
        }
      ).setPlaybackPosition(file, 100);
      requestedBlocks.length = 0;

      // Seed an in-flight block in the middle of normal playback (block 200) that is outside sync ranges
      const dummyInFlight = {
        wire: fakeWire,
        sentAt: Date.now(),
        hedged: false,
      };
      (
        record as unknown as { inFlightBlocks: Map<number, unknown> }
      ).inFlightBlocks.set(200, dummyInFlight);

      // Pre-populate block 10 so normal read can resolve once sync ends
      await cache.commitBlock(10, Buffer.alloc(REQUEST_BLOCK_BYTES, 7));

      // Enter sync focus targeting window near 500s of 1000s (~8 MiB = block 512)
      record.enterSyncFocus(
        file,
        [{ startAt: 500, duration: 30 }],
        1000,
        true,
      );
      expect(record.isSyncFocused()).toBe(true);
      expect(cancelledBlocks).toContain(200);

      // Normal playback read should suspend while syncFocus is active
      const ac = new AbortController();
      let normalReadResolved = false;
      const normalReadPromise = (async () => {
        for await (const chunk of record.readRange(
          file,
          10 * REQUEST_BLOCK_BYTES,
          11 * REQUEST_BLOCK_BYTES - 1,
          ac.signal,
        )) {
          expect(chunk.length).toBe(REQUEST_BLOCK_BYTES);
          normalReadResolved = true;
        }
      })();

      await new Promise((r) => setTimeout(r, 40));
      expect(normalReadResolved).toBe(false);

      // Verify pumpWire during syncFocus only requested header/footer/window blocks, never playhead 100..150
      const syncTargets = computeSyncTargetBlockRanges(
        file.offset,
        file.length,
        1000,
        [{ startAt: 500, duration: 30 }],
      );
      expect(requestedBlocks.length).toBeGreaterThan(0);
      for (const b of requestedBlocks) {
        const insideSyncTarget = syncTargets.some(
          (r) => b >= r.startBlock && b <= r.endBlock,
        );
        expect(insideSyncTarget).toBe(true);
      }

      // Sync read succeeds immediately while normal playback stays suspended
      const syncChunks: Buffer[] = [];
      for await (const chunk of record.readRange(
        file,
        512 * REQUEST_BLOCK_BYTES,
        513 * REQUEST_BLOCK_BYTES - 1,
        ac.signal,
        { isSync: true },
      )) {
        syncChunks.push(chunk);
      }
      expect(syncChunks).toHaveLength(1);
      expect(normalReadResolved).toBe(false);

      // Exiting sync focus wakes suspended normal read and restores playheadBlock = 100
      record.exitSyncFocus(true);
      expect(record.isSyncFocused()).toBe(false);
      await normalReadPromise;
      expect(normalReadResolved).toBe(true);
      expect(
        (record as unknown as { playheadBlock: number }).playheadBlock,
      ).toBe(10);
    } finally {
      await record.destroy(true);
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });

  it("cancels stale speculative P2 blocks when a real activeSyncRead seeks elsewhere", async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), "framezoo-sync-p2-"));
    const pieceLength = 512 * 1024;
    const totalBytes = 32 * 1024 * 1024; // 64 pieces = 2048 blocks
    const pieceCount = totalBytes / pieceLength;
    const dummyHash = createHash("sha1")
      .update(Buffer.alloc(pieceLength, 3))
      .digest("hex");
    const metadata: TorrentMetadata = {
      infoHash: "3333333333333333333333333333333333333333",
      length: totalBytes,
      pieceLength,
      pieces: Array.from({ length: pieceCount }, () => dummyHash),
      files: [{ name: "movie.mkv", path: "movie.mkv", offset: 0, length: totalBytes }],
    };

    const record = new TorrentRecord(
      {
        sourceId: "src-p2",
        url: "magnet:?xt=urn:btih:3333333333333333333333333333333333333333",
        maxBytes: 0,
        cacheRoot,
      },
      cacheRoot,
      () => {},
      async () => {},
      () => {},
    );

    try {
      record.metadata = metadata;
      const cache = new VirtualCache(path.join(cacheRoot, "vc"), metadata, undefined, {
        mode: "memory",
        memoryBudgetBytes: 64 * 1024 * 1024,
      });
      await cache.open();
      record.cache = cache;
      (record as unknown as { readyResolve: () => void }).readyResolve();

      const file = metadata.files[0]!;
      // Pre-populate header & footer edges so P2 jumps straight into speculative window blocks
      for (let b = 0; b < 256; b++) {
        await cache.commitBlock(b, Buffer.alloc(REQUEST_BLOCK_BYTES, 3));
      }
      for (let b = 2048 - 256; b < 2048; b++) {
        await cache.commitBlock(b, Buffer.alloc(REQUEST_BLOCK_BYTES, 3));
      }

      const cancelledBlocks: number[] = [];
      const requestedDuringSyncRead: number[] = [];
      let captureActiveSyncRequests = false;
      const pendingCbs = new Map<
        number,
        (err: Error | null, buf?: Buffer) => void
      >();

      const fakeWire = {
        peerChoking: false,
        amInterested: true,
        _finished: false,
        requests: [] as Array<{ bIdx: number }>,
        peerPieces: { get: () => true },
        downloadSpeed: () => 2 * 1024 * 1024,
        interested: () => {},
        destroy: () => {},
        request: (
          piece: number,
          offset: number,
          len: number,
          cb: (err: Error | null, buf?: Buffer) => void,
        ) => {
          const bIdx = Math.floor(
            (piece * pieceLength + offset) / REQUEST_BLOCK_BYTES,
          );
          fakeWire.requests.push({ bIdx });
          if (captureActiveSyncRequests) {
            requestedDuringSyncRead.push(bIdx);
            setTimeout(() => {
              const idx = fakeWire.requests.findIndex((r) => r.bIdx === bIdx);
              if (idx >= 0) fakeWire.requests.splice(idx, 1);
              cb(null, Buffer.alloc(len, 5));
            }, 5);
          } else {
            // Keep P2 speculative requests pending in-flight to verify cancellation on real seek
            pendingCbs.set(bIdx, cb);
          }
        },
        cancel: (piece: number, offset: number) => {
          const bIdx = Math.floor(
            (piece * pieceLength + offset) / REQUEST_BLOCK_BYTES,
          );
          cancelledBlocks.push(bIdx);
          const idx = fakeWire.requests.findIndex((r) => r.bIdx === bIdx);
          if (idx >= 0) fakeWire.requests.splice(idx, 1);
          const cb = pendingCbs.get(bIdx);
          if (cb) {
            pendingCbs.delete(bIdx);
            cb(new Error("cancelled"));
          }
        },
      };

      record.engine.swarm.wires.push(fakeWire as never);

      // Enter sync focus with speculative P2 window near 20% (~block 400)
      record.enterSyncFocus(file, [{ startAt: 200, duration: 30 }], 1000, true);
      expect(pendingCbs.size).toBeGreaterThan(0);

      // Real libmpv seek arrives at VBR-shifted block 1200 (far from speculative block 400)
      captureActiveSyncRequests = true;
      const ac = new AbortController();
      const chunks: Buffer[] = [];
      for await (const chunk of record.readRange(
        file,
        1200 * REQUEST_BLOCK_BYTES,
        1201 * REQUEST_BLOCK_BYTES - 1,
        ac.signal,
        { isSync: true, syncStartAt: 600, syncDuration: 30 },
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      // Stale speculative P2 blocks around block ~400 must have been cancelled immediately
      expect(cancelledBlocks.some((b) => b < 1000)).toBe(true);
      // All requests issued while activeSyncRead was running stayed on the real seek region (>= 1200)
      expect(requestedDuringSyncRead.length).toBeGreaterThan(0);
      expect(requestedDuringSyncRead.every((b) => b >= 1200)).toBe(true);
    } finally {
      await record.destroy(true);
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });
});
