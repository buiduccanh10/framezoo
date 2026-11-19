import { createHash } from "node:crypto";
import { access, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

import type { TorrentMetadata } from "torrent-stream";

export const VIRTUAL_PIECE_BYTES = 512 * 1024;
export const REQUEST_BLOCK_BYTES = 16 * 1024;
const BLOCKS_PER_RANGE = 8;

type CacheManifest = {
  version: 1;
  infoHash: string;
  pieceLength: number;
  torrentLength: number;
  verifiedPieces: number[];
};

type CacheStats = {
  downloadedBytes: number;
  verifiedBytes: number;
};

function hashValue(value: string | Buffer): string {
  if (Buffer.isBuffer(value)) return value.toString("hex").toLowerCase();
  if (/^[0-9a-f]{40}$/i.test(value)) return value.toLowerCase();
  return Buffer.from(value, "binary").toString("hex").toLowerCase();
}

/**
 * Sparse file cache for virtual pieces. The underlying torrent piece hash is
 * still the integrity boundary; virtual chunks only unblock the HTTP reader.
 */
export class VirtualCache {
  readonly virtualPieceBytes: number;
  readonly virtualPieceCount: number;
  private readonly completedVirtualPieces = new Set<number>();
  private readonly completedVirtualBlocks = new Map<number, Set<number>>();
  private readonly verifiedPieces = new Set<number>();
  private readonly inFlight = new Map<number, Promise<void>>();
  private file: FileHandle | null = null;
  private manifestPath = "";
  private dataPath = "";
  private stats: CacheStats = { downloadedBytes: 0, verifiedBytes: 0 };

  constructor(
    private readonly root: string,
    private readonly metadata: TorrentMetadata,
    private readonly onStats?: (stats: CacheStats) => void,
  ) {
    this.virtualPieceBytes =
      metadata.pieceLength > VIRTUAL_PIECE_BYTES &&
      metadata.pieceLength % VIRTUAL_PIECE_BYTES === 0
        ? VIRTUAL_PIECE_BYTES
        : metadata.pieceLength;
    this.virtualPieceCount = Math.ceil(
      metadata.length / this.virtualPieceBytes,
    );
  }

  async open() {
    await mkdir(this.root, { recursive: true });
    this.dataPath = path.join(this.root, "data.bin");
    this.manifestPath = path.join(this.root, "manifest.json");
    let exists = true;
    try {
      await access(this.dataPath);
    } catch {
      exists = false;
    }
    this.file = await open(this.dataPath, exists ? "r+" : "w+");

    try {
      const raw = JSON.parse(
        await readFile(this.manifestPath, "utf8"),
      ) as Partial<CacheManifest>;
      if (
        raw.version === 1 &&
        raw.infoHash === this.metadata.infoHash &&
        raw.pieceLength === this.metadata.pieceLength &&
        raw.torrentLength === this.metadata.length
      ) {
        for (const piece of raw.verifiedPieces ?? []) {
          if (
            Number.isInteger(piece) &&
            piece >= 0 &&
            piece < this.metadata.pieces.length
          ) {
            this.verifiedPieces.add(piece);
          }
        }
      }
    } catch {
      // A missing or corrupt manifest only invalidates cache metadata.
    }
    this.stats.verifiedBytes = [...this.verifiedPieces].reduce(
      (total, piece) => total + this.realPieceLength(piece),
      0,
    );
    this.publishStats();
  }

  getStats() {
    return { ...this.stats };
  }

  virtualStart(index: number) {
    return index * this.virtualPieceBytes;
  }

  virtualLength(index: number) {
    return Math.min(
      this.virtualPieceBytes,
      Math.max(0, this.metadata.length - this.virtualStart(index)),
    );
  }

  realPieceForVirtual(index: number) {
    return Math.floor(this.virtualStart(index) / this.metadata.pieceLength);
  }

  realPieceStart(index: number) {
    return index * this.metadata.pieceLength;
  }

  realPieceLength(index: number) {
    return Math.min(
      this.metadata.pieceLength,
      Math.max(0, this.metadata.length - this.realPieceStart(index)),
    );
  }

  isVerified(piece: number) {
    return this.verifiedPieces.has(piece);
  }

  async readVirtual(index: number) {
    const length = this.virtualLength(index);
    if (!this.file || length <= 0) throw new Error("torrent cache is closed");
    return this.readAt(this.virtualStart(index), length);
  }

  async readRange(position: number, length: number) {
    if (position < 0 || length < 0 || position + length > this.metadata.length) {
      throw new RangeError("torrent cache range is outside the torrent");
    }
    return this.readAt(position, length);
  }

  async ensureVirtualRange(
    index: number,
    offset: number,
    length: number,
    fetchBlock: (offset: number, length: number) => Promise<Buffer>,
  ) {
    const virtualLength = this.virtualLength(index);
    if (offset < 0 || length < 0 || offset + length > virtualLength) {
      throw new RangeError(`virtual range ${index}:${offset}+${length} is outside the piece`);
    }
    if (!length || this.verifiedPieces.has(this.realPieceForVirtual(index))) return;
    const blockStart = Math.floor(offset / REQUEST_BLOCK_BYTES) * REQUEST_BLOCK_BYTES;
    const blockEnd = Math.min(
      virtualLength,
      Math.ceil((offset + length) / REQUEST_BLOCK_BYTES) * REQUEST_BLOCK_BYTES,
    );
    const completed = this.completedVirtualBlocks.get(index) ?? new Set<number>();
    this.completedVirtualBlocks.set(index, completed);
    const missing: number[] = [];
    for (let block = blockStart; block < blockEnd; block += REQUEST_BLOCK_BYTES) {
      if (!completed.has(block)) missing.push(block);
    }
    let next = 0;
    const worker = async () => {
      while (true) {
        const block = missing[next++];
        if (block === undefined) return;
        const data = await fetchBlock(block, Math.min(REQUEST_BLOCK_BYTES, virtualLength - block));
        const expectedLength = Math.min(REQUEST_BLOCK_BYTES, virtualLength - block);
        if (data.length !== expectedLength) {
          throw new Error(`torrent block ${index}:${block} length ${data.length} != ${expectedLength}`);
        }
        await this.writeAt(this.virtualStart(index) + block, data);
        completed.add(block);
        this.stats.downloadedBytes += data.length;
        this.publishStats();
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(BLOCKS_PER_RANGE, missing.length) }, () => worker()),
    );
    if (completed.size !== Math.ceil(virtualLength / REQUEST_BLOCK_BYTES)) return;
    this.completedVirtualPieces.add(index);
    const realPiece = this.realPieceForVirtual(index);
    if (!this.isRealPieceComplete(realPiece)) return;
    if (await this.verifyRealPiece(realPiece)) return;
    throw new Error(`invalid torrent piece ${realPiece}`);
  }

  async ensureVirtual(
    index: number,
    fetchPiece: (index: number) => Promise<Buffer>,
  ): Promise<void> {
    if (index < 0 || index >= this.virtualPieceCount) {
      throw new RangeError(`virtual piece ${index} is outside the torrent`);
    }
    const realPiece = this.realPieceForVirtual(index);
    if (this.verifiedPieces.has(realPiece) || this.completedVirtualPieces.has(index)) {
      return;
    }
    const existing = this.inFlight.get(index);
    if (existing) return existing;

    const task = (async () => {
      await this.fillVirtual(index, fetchPiece);
      if (!this.isRealPieceComplete(realPiece)) return;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (await this.verifyRealPiece(realPiece)) return;
        const start = Math.floor(this.realPieceStart(realPiece) / this.virtualPieceBytes);
        const end = Math.ceil(
          (this.realPieceStart(realPiece) + this.realPieceLength(realPiece)) /
            this.virtualPieceBytes,
        );
        for (let virtualIndex = start; virtualIndex < end; virtualIndex++) {
          await this.fillVirtual(virtualIndex, fetchPiece);
        }
        if (!this.isRealPieceComplete(realPiece)) break;
      }
      if (await this.verifyRealPiece(realPiece)) return;
      throw new Error(`invalid torrent piece ${realPiece}`);
    })();
    this.inFlight.set(index, task);
    try {
      await task;
    } finally {
      this.inFlight.delete(index);
    }
  }

  private async fillVirtual(
    index: number,
    fetchPiece: (index: number) => Promise<Buffer>,
  ) {
    if (this.completedVirtualPieces.has(index)) return;
    const data = await fetchPiece(index);
    const expectedLength = this.virtualLength(index);
    if (data.length !== expectedLength) {
      throw new Error(
        `virtual piece ${index} length ${data.length} != ${expectedLength}`,
      );
    }
    await this.writeAt(this.virtualStart(index), data);
    this.completedVirtualPieces.add(index);
    const blocks = new Set<number>();
    for (let block = 0; block < expectedLength; block += REQUEST_BLOCK_BYTES) blocks.add(block);
    this.completedVirtualBlocks.set(index, blocks);
    this.stats.downloadedBytes += data.length;
    this.publishStats();
  }

  private isRealPieceComplete(piece: number) {
    if (this.verifiedPieces.has(piece)) return true;
    const start = Math.floor(this.realPieceStart(piece) / this.virtualPieceBytes);
    const end = Math.ceil(
      (this.realPieceStart(piece) + this.realPieceLength(piece)) /
        this.virtualPieceBytes,
    );
    for (let index = start; index < end; index++) {
      if (!this.completedVirtualPieces.has(index)) return false;
    }
    return true;
  }

  private async verifyRealPiece(piece: number) {
    if (this.verifiedPieces.has(piece)) return true;
    const buffer = await this.readAt(
      this.realPieceStart(piece),
      this.realPieceLength(piece),
    );
    const actual = createHash("sha1").update(buffer).digest("hex");
    const expected = hashValue(this.metadata.pieces[piece] ?? "");
    if (actual !== expected) {
      const start = Math.floor(this.realPieceStart(piece) / this.virtualPieceBytes);
      const end = Math.ceil(
        (this.realPieceStart(piece) + this.realPieceLength(piece)) /
          this.virtualPieceBytes,
      );
      for (let index = start; index < end; index++) {
        this.completedVirtualPieces.delete(index);
        this.completedVirtualBlocks.delete(index);
      }
      return false;
    }
    this.verifiedPieces.add(piece);
    this.stats.verifiedBytes += this.realPieceLength(piece);
    await this.persistManifest();
    this.publishStats();
    return true;
  }

  private async persistManifest() {
    const manifest: CacheManifest = {
      version: 1,
      infoHash: this.metadata.infoHash,
      pieceLength: this.metadata.pieceLength,
      torrentLength: this.metadata.length,
      verifiedPieces: [...this.verifiedPieces].sort((a, b) => a - b),
    };
    const temporary = `${this.manifestPath}.tmp`;
    await writeFile(temporary, JSON.stringify(manifest), "utf8");
    await rename(temporary, this.manifestPath);
  }

  private async readAt(position: number, length: number) {
    if (!this.file) throw new Error("torrent cache is closed");
    const buffer = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const result = await this.file.read(
        buffer,
        offset,
        length - offset,
        position + offset,
      );
      if (!result.bytesRead) {
        buffer.fill(0, offset);
        break;
      }
      offset += result.bytesRead;
    }
    return buffer;
  }

  private async writeAt(position: number, buffer: Buffer) {
    if (!this.file) throw new Error("torrent cache is closed");
    let offset = 0;
    while (offset < buffer.length) {
      const result = await this.file.write(
        buffer,
        offset,
        buffer.length - offset,
        position + offset,
      );
      offset += result.bytesWritten;
    }
  }

  private publishStats() {
    this.onStats?.(this.getStats());
  }

  async close() {
    await this.file?.close();
    this.file = null;
  }

  async discard() {
    await this.close();
    await rm(this.root, { recursive: true, force: true });
  }
}
