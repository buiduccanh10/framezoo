import { Agent, request as httpRequest } from "node:http";
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  TorrentWorker,
  computePrefetchEnd,
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
