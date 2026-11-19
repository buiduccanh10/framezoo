import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { TorrentMetadata } from "torrent-stream";
import { VIRTUAL_PIECE_BYTES, VirtualCache } from "./virtualCache";

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
    } finally {
      await cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
