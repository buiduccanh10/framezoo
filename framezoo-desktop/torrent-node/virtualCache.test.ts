import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { TorrentMetadata } from "torrent-stream";
import { VIRTUAL_PIECE_BYTES, REQUEST_BLOCK_BYTES, VirtualCache } from "./virtualCache";

describe("VirtualCache", () => {
  it("serves a virtual piece before a 64 MiB real piece is complete", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "framezoo-node-cache-"));
    const realPiece = Buffer.alloc(64 * 1024 * 1024, 0x5a);
    const metadata: TorrentMetadata = {
      infoHash: "0123456789012345678901234567890123456789",
      length: realPiece.length,
      pieceLength: realPiece.length,
      pieces: [createHash("sha1").update(realPiece).digest("hex")],
      files: [{ name: "fixture.mkv", path: "fixture.mkv", offset: 0, length: realPiece.length }],
    };
    const cache = new VirtualCache(directory, metadata);

    try {
      await cache.open();
      expect(cache.virtualPieceBytes).toBe(VIRTUAL_PIECE_BYTES);
      expect(cache.virtualPieceCount).toBe(128);

      await cache.ensureVirtual(0, async () => realPiece.subarray(0, VIRTUAL_PIECE_BYTES));
      expect(await cache.readVirtual(0)).toEqual(realPiece.subarray(0, VIRTUAL_PIECE_BYTES));
      expect(cache.getStats().verifiedBytes).toBe(0);

    } finally {
      await cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refetches a real piece after a bad virtual block", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "framezoo-node-cache-"));
    const data = Buffer.alloc(VIRTUAL_PIECE_BYTES * 4, 0x2a);
    const metadata: TorrentMetadata = {
      infoHash: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
      length: data.length,
      pieceLength: data.length,
      pieces: [createHash("sha1").update(data).digest("hex")],
      files: [{ name: "fixture.mkv", path: "fixture.mkv", offset: 0, length: data.length }],
    };
    const cache = new VirtualCache(directory, metadata);
    let firstFetch = true;

    try {
      await cache.open();
      await cache.ensureVirtual(0, async (index) => {
        const start = cache.virtualStart(index);
        const value = data.subarray(start, start + cache.virtualLength(index));
        if (index === 0 && firstFetch) {
          firstFetch = false;
          return Buffer.alloc(value.length, 0);
        }
        return value;
      });
      for (let index = 1; index < cache.virtualPieceCount; index++) {
        await cache.ensureVirtual(index, async (current) => {
          const start = cache.virtualStart(current);
          return data.subarray(start, start + cache.virtualLength(current));
        });
      }

      expect(await cache.readVirtual(0)).toEqual(data.subarray(0, VIRTUAL_PIECE_BYTES));
      expect(cache.getStats().verifiedBytes).toBe(data.length);
    } finally {
      await cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fetches only blocks intersecting a range", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "framezoo-node-cache-"));
    const data = Buffer.alloc(VIRTUAL_PIECE_BYTES * 2, 0x7b);
    const metadata: TorrentMetadata = {
      infoHash: "1234567890123456789012345678901234567890",
      length: data.length,
      pieceLength: data.length,
      pieces: [createHash("sha1").update(data).digest("hex")],
      files: [{ name: "fixture.mkv", path: "fixture.mkv", offset: 0, length: data.length }],
    };
    const cache = new VirtualCache(directory, metadata);
    const requests: Array<[number, number]> = [];

    try {
      await cache.open();
      await cache.ensureVirtualRange(0, 20_000, 20_000, async (offset, length) => {
        requests.push([offset, length]);
        return data.subarray(offset, offset + length);
      });
      expect(requests.length).toBe(2);
      expect(await cache.readRange(20_000, 20_000)).toEqual(data.subarray(20_000, 40_000));
      expect(cache.getStats().verifiedBytes).toBe(0);
      expect(cache.cachedBytesInRange(0, data.length)).toBe(2 * REQUEST_BLOCK_BYTES);
    } finally {
      await cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("counts unique downloaded and verified bytes scoped to the selected file range", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "framezoo-node-cache-"));
    const pieceLength = VIRTUAL_PIECE_BYTES * 2;
    const piece0 = Buffer.alloc(pieceLength, 0x11);
    const piece1 = Buffer.alloc(pieceLength, 0x22);
    const data = Buffer.concat([piece0, piece1]);
    const metadata: TorrentMetadata = {
      infoHash: "fedcba9876543210fedcba9876543210fedcba98",
      length: data.length,
      pieceLength,
      pieces: [
        createHash("sha1").update(piece0).digest("hex"),
        createHash("sha1").update(piece1).digest("hex"),
      ],
      files: [
        { name: "ep1.mkv", path: "ep1.mkv", offset: 0, length: pieceLength },
        { name: "ep2.mkv", path: "ep2.mkv", offset: pieceLength, length: pieceLength },
      ],
    };
    const cache = new VirtualCache(directory, metadata);

    try {
      await cache.open();
      // Complete & verify piece 0 (ep1.mkv), and partially fetch 1 block in piece 1 (ep2.mkv).
      await cache.ensureVirtual(0, async () => piece0.subarray(0, VIRTUAL_PIECE_BYTES));
      await cache.ensureVirtual(1, async () => piece0.subarray(VIRTUAL_PIECE_BYTES));
      await cache.ensureVirtualRange(2, 0, REQUEST_BLOCK_BYTES, async (offset, length) =>
        piece1.subarray(offset, offset + length),
      );
      // Overlapping range should not double-count the already cached block.
      await cache.ensureVirtualRange(2, 0, REQUEST_BLOCK_BYTES * 2, async (offset, length) =>
        piece1.subarray(offset, offset + length),
      );

      expect(cache.cachedBytesInRange(0, pieceLength)).toBe(pieceLength);
      expect(cache.cachedBytesInRange(pieceLength, pieceLength)).toBe(REQUEST_BLOCK_BYTES * 2);
    } finally {
      await cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("deduplicates concurrent block fetches and recovers when the first caller aborts", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "framezoo-node-cache-"));
    const data = Buffer.alloc(VIRTUAL_PIECE_BYTES, 0x44);
    const metadata: TorrentMetadata = {
      infoHash: "00112233445566778899aabbccddeeff00112233",
      length: data.length,
      pieceLength: data.length,
      pieces: [createHash("sha1").update(data).digest("hex")],
      files: [{ name: "fixture.mkv", path: "fixture.mkv", offset: 0, length: data.length }],
    };
    const cache = new VirtualCache(directory, metadata);
    const blockCalls = new Map<number, number>();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let failBlock0 = true;

    try {
      await cache.open();
      const firstCaller = cache
        .ensureVirtualRange(0, 0, REQUEST_BLOCK_BYTES * 2, async (offset, length) => {
          blockCalls.set(offset, (blockCalls.get(offset) ?? 0) + 1);
          if (offset === 0 && failBlock0) {
            await firstGate;
            failBlock0 = false;
            throw new Error("caller aborted");
          }
          await firstGate;
          return data.subarray(offset, offset + length);
        })
        .catch(() => "failed");

      // Wait a microtask so firstCaller populates inFlightBlocks.
      await new Promise((resolve) => setTimeout(resolve, 10));

      const secondCaller = cache.ensureVirtualRange(
        0,
        0,
        VIRTUAL_PIECE_BYTES,
        async (offset, length) => {
          blockCalls.set(offset, (blockCalls.get(offset) ?? 0) + 1);
          return data.subarray(offset, offset + length);
        },
      );

      releaseFirst();
      expect(await firstCaller).toBe("failed");
      await secondCaller;

      // Block 0 had 2 calls (1 failed + 1 recovery); block 16 KiB was deduplicated to 1 call.
      expect(blockCalls.get(0)).toBe(2);
      expect(blockCalls.get(REQUEST_BLOCK_BYTES)).toBe(1);
      expect(cache.getStats().verifiedBytes).toBe(data.length);
      expect(cache.cachedBytesInRange(0, data.length)).toBe(data.length);
    } finally {
      await cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("commits out-of-order blocks, deduplicates hotswaps, and verifies asynchronously", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "framezoo-node-cache-"));
    const data = Buffer.alloc(VIRTUAL_PIECE_BYTES, 0x6c);
    const metadata: TorrentMetadata = {
      infoHash: "99887766554433221100ffeeddccbbaa99887766",
      length: data.length,
      pieceLength: data.length,
      pieces: [createHash("sha1").update(data).digest("hex")],
      files: [{ name: "fixture.mkv", path: "fixture.mkv", offset: 0, length: data.length }],
    };
    const cache = new VirtualCache(directory, metadata);
    const blockCount = VIRTUAL_PIECE_BYTES / REQUEST_BLOCK_BYTES;

    try {
      await cache.open();
      expect(cache.hasBlock(0)).toBe(false);

      // Commit out-of-order + concurrent duplicate hotswap commits on block 0.
      const b0 = data.subarray(0, REQUEST_BLOCK_BYTES);
      await Promise.all([cache.commitBlock(0, b0), cache.commitBlock(0, b0)]);
      await cache.commitBlock(0, b0);
      expect(cache.hasBlock(0)).toBe(true);
      expect(cache.getStats().downloadedBytes).toBe(REQUEST_BLOCK_BYTES);

      // Commit remaining blocks in reverse order.
      for (let idx = blockCount - 1; idx >= 1; idx--) {
        const start = idx * REQUEST_BLOCK_BYTES;
        await cache.commitBlock(idx, data.subarray(start, start + REQUEST_BLOCK_BYTES));
      }

      // Asynchronous real-piece SHA-1 verification finishes shortly after the last block commits.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(cache.getStats().downloadedBytes).toBe(data.length);
      expect(cache.getStats().verifiedBytes).toBe(data.length);
      expect(cache.cachedBytesInRange(0, data.length)).toBe(data.length);
      expect(await cache.readRange(0, data.length)).toEqual(data);
    } finally {
      await cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
