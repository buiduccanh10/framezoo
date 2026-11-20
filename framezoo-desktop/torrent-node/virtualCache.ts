import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

import type { TorrentMetadata } from "torrent-stream";

export const VIRTUAL_PIECE_BYTES = 512 * 1024;
export const REQUEST_BLOCK_BYTES = 16 * 1024;
const BLOCKS_PER_RANGE = 32;
export const DEFAULT_MEMORY_BUDGET_BYTES = 192 * 1024 * 1024;
export const DEFAULT_SEGMENT_BYTES = 32 * 1024 * 1024;
export const PINNED_EDGE_BYTES = 4 * 1024 * 1024;
const MAX_OPEN_SEGMENTS = 8;

export type VirtualCacheMode = "disk" | "memory";

export type VirtualCacheOptions = {
  mode?: VirtualCacheMode;
  memoryBudgetBytes?: number;
  targetSegmentBytes?: number;
};

export type EvictionGuard = {
  playheadPos: number;
  fileOffset: number;
  fileLength: number;
  keepBehindBytes: number;
  keepAheadBytes: number;
  pinnedEdgeBytes?: number;
  activeByteRanges?: Array<{ start: number; end: number }>;
};

type CacheManifest = {
  version: 2;
  infoHash: string;
  pieceLength: number;
  torrentLength: number;
  segmentBytes: number;
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

function overlapsAny(
  start: number,
  end: number,
  ranges: Array<{ start: number; end: number }>,
): boolean {
  for (const r of ranges) {
    if (start < r.end && end > r.start) return true;
  }
  return false;
}

/**
 * Segment-backed (disk) or sliding-window (memory) virtual piece cache.
 * The underlying torrent piece SHA-1 hash remains the integrity boundary;
 * virtual chunks only unblock the HTTP reader.
 */
export class VirtualCache {
  readonly mode: VirtualCacheMode;
  readonly virtualPieceBytes: number;
  readonly virtualPieceCount: number;
  readonly memoryBudgetBytes: number;
  readonly piecesPerSegment: number;
  readonly segmentBytes: number;
  readonly segmentCount: number;
  private readonly completedVirtualPieces = new Set<number>();
  private readonly completedVirtualBlocks = new Map<number, Set<number>>();
  private readonly verifiedPieces = new Set<number>();
  private readonly inFlight = new Map<number, Promise<void>>();
  private readonly inFlightBlocks = new Map<string, Promise<void>>();
  private readonly committingBlocks = new Map<number, Promise<void>>();
  private readonly verifyingPieces = new Map<number, Promise<boolean>>();
  private readonly memPieces = new Map<number, Buffer>();
  private memUsedBytes = 0;
  private readonly diskSegments = new Map<number, number>();
  private readonly fdPool = new Map<number, FileHandle>();
  private readonly pendingOpens = new Map<number, Promise<FileHandle | null>>();
  private readonly activeIo = new Map<number, number>();
  private manifestChain: Promise<void> = Promise.resolve();
  private evictPromise: Promise<number> | null = null;
  private opened = false;
  private closed = false;
  private manifestPath = "";
  private stats: CacheStats = { downloadedBytes: 0, verifiedBytes: 0 };

  constructor(
    private readonly root: string,
    private readonly metadata: TorrentMetadata,
    private readonly onStats?: (stats: CacheStats) => void,
    options?: VirtualCacheOptions,
  ) {
    this.mode = options?.mode ?? "disk";
    this.virtualPieceBytes =
      metadata.pieceLength > VIRTUAL_PIECE_BYTES &&
      metadata.pieceLength % VIRTUAL_PIECE_BYTES === 0
        ? VIRTUAL_PIECE_BYTES
        : metadata.pieceLength;
    this.virtualPieceCount = Math.ceil(
      metadata.length / this.virtualPieceBytes,
    );
    this.memoryBudgetBytes = Math.max(
      options?.memoryBudgetBytes ?? DEFAULT_MEMORY_BUDGET_BYTES,
      metadata.pieceLength,
    );
    const targetSeg = Math.max(
      metadata.pieceLength,
      options?.targetSegmentBytes ?? DEFAULT_SEGMENT_BYTES,
    );
    this.piecesPerSegment = Math.max(
      1,
      Math.floor(targetSeg / metadata.pieceLength),
    );
    this.segmentBytes = this.piecesPerSegment * metadata.pieceLength;
    this.segmentCount = Math.ceil(metadata.length / this.segmentBytes);
  }

  private segmentPath(segIdx: number) {
    return path.join(this.root, `seg-${segIdx}.bin`);
  }

  async open() {
    if (this.mode === "memory") {
      this.opened = true;
      this.closed = false;
      this.publishStats();
      return;
    }

    await mkdir(this.root, { recursive: true });
    this.manifestPath = path.join(this.root, "manifest.json");
    const legacyDataPath = path.join(this.root, "data.bin");
    let hasLegacyData = false;
    try {
      await access(legacyDataPath);
      hasLegacyData = true;
    } catch {
      hasLegacyData = false;
    }

    let parsedManifest: Partial<CacheManifest> | null = null;
    if (!hasLegacyData) {
      try {
        const raw = JSON.parse(
          await readFile(this.manifestPath, "utf8"),
        ) as Partial<CacheManifest>;
        if (
          raw.version === 2 &&
          raw.infoHash === this.metadata.infoHash &&
          raw.pieceLength === this.metadata.pieceLength &&
          raw.torrentLength === this.metadata.length &&
          raw.segmentBytes === this.segmentBytes
        ) {
          parsedManifest = raw;
        }
      } catch {
        parsedManifest = null;
      }
    }

    if (hasLegacyData || !parsedManifest) {
      await rm(legacyDataPath, { force: true }).catch(() => {});
      await rm(this.manifestPath, { force: true }).catch(() => {});
      for (const entry of await readdir(this.root, { withFileTypes: true }).catch(
        () => [],
      )) {
        if (/^seg-\d+\.bin$/.test(entry.name)) {
          await rm(path.join(this.root, entry.name), { force: true }).catch(
            () => {},
          );
        }
      }
    } else {
      for (const entry of await readdir(this.root, { withFileTypes: true }).catch(
        () => [],
      )) {
        const match = /^seg-(\d+)\.bin$/.exec(entry.name);
        if (!match || !entry.isFile()) continue;
        const segIdx = Number(match[1]);
        if (
          !Number.isInteger(segIdx) ||
          segIdx < 0 ||
          segIdx >= this.segmentCount
        ) {
          await rm(path.join(this.root, entry.name), { force: true }).catch(
            () => {},
          );
          continue;
        }
        const st = await stat(path.join(this.root, entry.name)).catch(
          () => null,
        );
        if (!st) continue;
        const physical =
          process.platform !== "win32" && Number.isFinite(st.blocks)
            ? Math.min(st.size, st.blocks * 512)
            : st.size;
        this.diskSegments.set(segIdx, physical);
      }

      for (const piece of parsedManifest.verifiedPieces ?? []) {
        if (
          Number.isInteger(piece) &&
          piece >= 0 &&
          piece < this.metadata.pieces.length &&
          this.diskSegments.has(Math.floor(piece / this.piecesPerSegment))
        ) {
          this.verifiedPieces.add(piece);
        }
      }
    }

    this.opened = true;
    this.closed = false;
    this.stats.verifiedBytes = [...this.verifiedPieces].reduce(
      (total, piece) => total + this.realPieceLength(piece),
      0,
    );
    this.publishStats();
  }

  getStats() {
    return { ...this.stats };
  }

  usedBytes(): number {
    if (this.mode === "memory") return this.memUsedBytes;
    let total = 0;
    for (const size of this.diskSegments.values()) total += size;
    return total;
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

  isVirtualComplete(index: number) {
    return (
      this.verifiedPieces.has(this.realPieceForVirtual(index)) ||
      this.completedVirtualPieces.has(index)
    );
  }

  hasBlock(absBlockIdx: number): boolean {
    const pos = absBlockIdx * REQUEST_BLOCK_BYTES;
    if (pos < 0 || pos >= this.metadata.length) return false;
    const realPiece = Math.floor(pos / this.metadata.pieceLength);
    if (this.verifiedPieces.has(realPiece)) return true;
    const vIdx = Math.floor(pos / this.virtualPieceBytes);
    if (this.completedVirtualPieces.has(vIdx)) return true;
    const blockOffset = pos - this.virtualStart(vIdx);
    return Boolean(this.completedVirtualBlocks.get(vIdx)?.has(blockOffset));
  }

  async commitBlock(absBlockIdx: number, data: Buffer): Promise<void> {
    const pos = absBlockIdx * REQUEST_BLOCK_BYTES;
    if (pos < 0 || pos >= this.metadata.length) {
      throw new RangeError(`torrent block ${absBlockIdx} is outside the torrent`);
    }
    const expectedLength = Math.min(
      REQUEST_BLOCK_BYTES,
      this.metadata.length - pos,
    );
    if (data.length !== expectedLength) {
      throw new Error(
        `torrent block ${absBlockIdx} length ${data.length} != ${expectedLength}`,
      );
    }
    if (this.hasBlock(absBlockIdx)) return;
    const inProgress = this.committingBlocks.get(absBlockIdx);
    if (inProgress) return inProgress;

    const task = (async () => {
      if (this.hasBlock(absBlockIdx)) return;
      const vIdx = Math.floor(pos / this.virtualPieceBytes);
      const blockOffset = pos - this.virtualStart(vIdx);
      const realPiece = this.realPieceForVirtual(vIdx);
      await this.writeAt(pos, data);
      if (this.closed || this.verifiedPieces.has(realPiece)) return;
      const completed =
        this.completedVirtualBlocks.get(vIdx) ?? new Set<number>();
      this.completedVirtualBlocks.set(vIdx, completed);
      if (!completed.has(blockOffset)) {
        completed.add(blockOffset);
        this.stats.downloadedBytes += data.length;
        this.publishStats();
      }
      const virtualLength = this.virtualLength(vIdx);
      if (completed.size === Math.ceil(virtualLength / REQUEST_BLOCK_BYTES)) {
        this.completedVirtualPieces.add(vIdx);
        if (this.isRealPieceComplete(realPiece)) {
          void this.verifyRealPiece(realPiece).catch(() => {});
        }
      }
    })();
    this.committingBlocks.set(absBlockIdx, task);
    try {
      await task;
    } finally {
      if (this.committingBlocks.get(absBlockIdx) === task) {
        this.committingBlocks.delete(absBlockIdx);
      }
    }
  }

  /** Unique downloaded or verified bytes within [start, start + length) (matches Stremio file progress). */
  cachedBytesInRange(start: number, length: number): number {
    const rangeStart = Math.max(0, start);
    const rangeEnd = Math.min(this.metadata.length, start + length);
    if (rangeEnd <= rangeStart) return 0;

    let total = 0;
    const firstPiece = Math.floor(rangeStart / this.metadata.pieceLength);
    const lastPiece = Math.floor((rangeEnd - 1) / this.metadata.pieceLength);
    for (let piece = firstPiece; piece <= lastPiece; piece++) {
      const pieceStart = this.realPieceStart(piece);
      const segStart = Math.max(rangeStart, pieceStart);
      const segEnd = Math.min(
        rangeEnd,
        pieceStart + this.realPieceLength(piece),
      );
      if (segEnd <= segStart) continue;
      if (this.verifiedPieces.has(piece)) {
        total += segEnd - segStart;
        continue;
      }
      const firstVirtual = Math.floor(segStart / this.virtualPieceBytes);
      const lastVirtual = Math.floor((segEnd - 1) / this.virtualPieceBytes);
      for (let v = firstVirtual; v <= lastVirtual; v++) {
        const vStart = this.virtualStart(v);
        const vSegStart = Math.max(segStart, vStart);
        const vSegEnd = Math.min(segEnd, vStart + this.virtualLength(v));
        if (this.completedVirtualPieces.has(v)) {
          total += vSegEnd - vSegStart;
          continue;
        }
        const blocks = this.completedVirtualBlocks.get(v);
        if (!blocks?.size) continue;
        for (const block of blocks) {
          const bStart = Math.max(vSegStart, vStart + block);
          const bEnd = Math.min(vSegEnd, vStart + block + REQUEST_BLOCK_BYTES);
          if (bEnd > bStart) total += bEnd - bStart;
        }
      }
    }
    return total;
  }

  async readVirtual(index: number) {
    const length = this.virtualLength(index);
    if (!this.opened || this.closed || length <= 0) {
      throw new Error("torrent cache is closed");
    }
    return this.readAt(this.virtualStart(index), length);
  }

  async readRange(position: number, length: number) {
    if (
      position < 0 ||
      length < 0 ||
      position + length > this.metadata.length
    ) {
      throw new RangeError("torrent cache range is outside the torrent");
    }
    return this.readAt(position, length);
  }

  async ensureVirtualRange(
    index: number,
    offset: number,
    length: number,
    fetchBlock: (offset: number, length: number) => Promise<Buffer>,
    maxConcurrency = BLOCKS_PER_RANGE,
  ) {
    const virtualLength = this.virtualLength(index);
    if (offset < 0 || length < 0 || offset + length > virtualLength) {
      throw new RangeError(
        `virtual range ${index}:${offset}+${length} is outside the piece`,
      );
    }
    if (!length || this.isVirtualComplete(index)) return;
    const blockStart =
      Math.floor(offset / REQUEST_BLOCK_BYTES) * REQUEST_BLOCK_BYTES;
    const blockEnd = Math.min(
      virtualLength,
      Math.ceil((offset + length) / REQUEST_BLOCK_BYTES) * REQUEST_BLOCK_BYTES,
    );
    const completed =
      this.completedVirtualBlocks.get(index) ?? new Set<number>();
    this.completedVirtualBlocks.set(index, completed);
    const missing: number[] = [];
    for (
      let block = blockStart;
      block < blockEnd;
      block += REQUEST_BLOCK_BYTES
    ) {
      if (!completed.has(block)) missing.push(block);
    }
    let next = 0;
    const worker = async () => {
      while (true) {
        const block = missing[next++];
        if (block === undefined) return;
        if (completed.has(block)) continue;
        const key = `${index}:${block}`;
        const existing = this.inFlightBlocks.get(key);
        if (existing) {
          try {
            await existing;
          } catch {
            // An earlier caller aborted or failed; fall through to fetch if still missing.
          }
          if (completed.has(block)) continue;
        }
        const task = (async () => {
          const expectedLength = Math.min(
            REQUEST_BLOCK_BYTES,
            virtualLength - block,
          );
          const data = await fetchBlock(block, expectedLength);
          if (data.length !== expectedLength) {
            throw new Error(
              `torrent block ${index}:${block} length ${data.length} != ${expectedLength}`,
            );
          }
          await this.writeAt(this.virtualStart(index) + block, data);
          completed.add(block);
          this.stats.downloadedBytes += data.length;
          this.publishStats();
        })();
        this.inFlightBlocks.set(key, task);
        try {
          await task;
        } finally {
          if (this.inFlightBlocks.get(key) === task) {
            this.inFlightBlocks.delete(key);
          }
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(maxConcurrency, missing.length) }, () =>
        worker(),
      ),
    );
    if (completed.size !== Math.ceil(virtualLength / REQUEST_BLOCK_BYTES))
      return;
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
    if (
      this.verifiedPieces.has(realPiece) ||
      this.completedVirtualPieces.has(index)
    ) {
      return;
    }
    const existing = this.inFlight.get(index);
    if (existing) return existing;

    const task = (async () => {
      await this.fillVirtual(index, fetchPiece);
      if (!this.isRealPieceComplete(realPiece)) return;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (await this.verifyRealPiece(realPiece)) return;
        const start = Math.floor(
          this.realPieceStart(realPiece) / this.virtualPieceBytes,
        );
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
    for (let block = 0; block < expectedLength; block += REQUEST_BLOCK_BYTES)
      blocks.add(block);
    this.completedVirtualBlocks.set(index, blocks);
    this.stats.downloadedBytes += data.length;
    this.publishStats();
  }

  private isRealPieceComplete(piece: number) {
    if (this.verifiedPieces.has(piece)) return true;
    const start = Math.floor(
      this.realPieceStart(piece) / this.virtualPieceBytes,
    );
    const end = Math.ceil(
      (this.realPieceStart(piece) + this.realPieceLength(piece)) /
        this.virtualPieceBytes,
    );
    for (let index = start; index < end; index++) {
      if (!this.completedVirtualPieces.has(index)) return false;
    }
    return true;
  }

  private clearVirtualTrackingForPiece(piece: number) {
    const start = Math.floor(
      this.realPieceStart(piece) / this.virtualPieceBytes,
    );
    const end = Math.ceil(
      (this.realPieceStart(piece) + this.realPieceLength(piece)) /
        this.virtualPieceBytes,
    );
    for (let index = start; index < end; index++) {
      this.completedVirtualPieces.delete(index);
      this.completedVirtualBlocks.delete(index);
    }
  }

  private verifyRealPiece(piece: number): Promise<boolean> {
    if (this.verifiedPieces.has(piece)) return Promise.resolve(true);
    const existing = this.verifyingPieces.get(piece);
    if (existing) return existing;
    const task = (async () => {
      const buffer = await this.readAt(
        this.realPieceStart(piece),
        this.realPieceLength(piece),
      );
      const actual = createHash("sha1").update(buffer).digest("hex");
      const expected = hashValue(this.metadata.pieces[piece] ?? "");
      if (actual !== expected) {
        this.clearVirtualTrackingForPiece(piece);
        return false;
      }
      if (this.closed) return false;
      this.verifiedPieces.add(piece);
      this.clearVirtualTrackingForPiece(piece);
      this.stats.verifiedBytes += this.realPieceLength(piece);
      await this.persistManifest();
      this.publishStats();
      return true;
    })();
    this.verifyingPieces.set(piece, task);
    return task.finally(() => {
      if (this.verifyingPieces.get(piece) === task) {
        this.verifyingPieces.delete(piece);
      }
    });
  }

  private isVirtualBusy(vIdx: number): boolean {
    if (this.inFlight.has(vIdx)) return true;
    if (this.verifyingPieces.has(this.realPieceForVirtual(vIdx))) return true;
    for (const absBlockIdx of this.committingBlocks.keys()) {
      const pos = absBlockIdx * REQUEST_BLOCK_BYTES;
      if (Math.floor(pos / this.virtualPieceBytes) === vIdx) return true;
    }
    const prefix = `${vIdx}:`;
    for (const key of this.inFlightBlocks.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  private isSegmentBusy(segIdx: number): boolean {
    if ((this.activeIo.get(segIdx) ?? 0) > 0) return true;
    for (const piece of this.verifyingPieces.keys()) {
      if (Math.floor(piece / this.piecesPerSegment) === segIdx) return true;
    }
    for (const absBlockIdx of this.committingBlocks.keys()) {
      const pos = absBlockIdx * REQUEST_BLOCK_BYTES;
      if (Math.floor(pos / this.segmentBytes) === segIdx) return true;
    }
    for (const vIdx of this.inFlight.keys()) {
      if (Math.floor(this.virtualStart(vIdx) / this.segmentBytes) === segIdx) {
        return true;
      }
    }
    for (const key of this.inFlightBlocks.keys()) {
      const vIdx = Number(key.split(":", 1)[0]);
      if (Math.floor(this.virtualStart(vIdx) / this.segmentBytes) === segIdx) {
        return true;
      }
    }
    return false;
  }

  private buildProtection(guard: EvictionGuard) {
    const fileOffset = Math.max(0, guard.fileOffset);
    const fileLength = Math.max(0, guard.fileLength);
    const fileEnd = Math.min(this.metadata.length, fileOffset + fileLength);
    const edgeBytes =
      guard.pinnedEdgeBytes ??
      Math.min(PINNED_EDGE_BYTES, Math.floor(fileLength / 8));
    const winStart = Math.max(
      0,
      guard.playheadPos - Math.max(0, guard.keepBehindBytes),
    );
    const winEnd = Math.min(
      this.metadata.length,
      guard.playheadPos + Math.max(0, guard.keepAheadBytes),
    );
    const ranges: Array<{ start: number; end: number }> = [];
    if (fileEnd > fileOffset && edgeBytes > 0) {
      ranges.push(
        { start: fileOffset, end: Math.min(fileEnd, fileOffset + edgeBytes) },
        { start: Math.max(fileOffset, fileEnd - edgeBytes), end: fileEnd },
      );
    }
    if (winEnd > winStart) {
      ranges.push({ start: winStart, end: winEnd });
    }
    for (const active of guard.activeByteRanges ?? []) {
      if (active.end > active.start) ranges.push(active);
    }
    return { ranges, winStart };
  }

  private collectEvictable(
    ids: Iterable<number>,
    spanOf: (id: number) => { start: number; end: number },
    isBusy: (id: number) => boolean,
    guard: EvictionGuard,
  ): number[] {
    const { ranges, winStart } = this.buildProtection(guard);
    const behind: number[] = [];
    const ahead: number[] = [];
    for (const id of ids) {
      if (isBusy(id)) continue;
      const { start, end } = spanOf(id);
      if (overlapsAny(start, end, ranges)) continue;
      if (end <= winStart) behind.push(id);
      else ahead.push(id);
    }
    behind.sort((a, b) => a - b);
    ahead.sort((a, b) => b - a);
    return [...behind, ...ahead];
  }

  evictMemory(
    guard: EvictionGuard,
    targetBytes = this.memoryBudgetBytes,
  ): number {
    if (this.mode !== "memory" || this.memUsedBytes <= targetBytes) return 0;
    const candidates = this.collectEvictable(
      this.memPieces.keys(),
      (vIdx) => {
        const start = this.virtualStart(vIdx);
        return { start, end: start + this.virtualLength(vIdx) };
      },
      (vIdx) => this.isVirtualBusy(vIdx),
      guard,
    );
    let freed = 0;
    for (const vIdx of candidates) {
      if (this.memUsedBytes <= targetBytes) break;
      const buf = this.memPieces.get(vIdx);
      if (!buf) continue;
      const realPiece = this.realPieceForVirtual(vIdx);
      if (this.verifiedPieces.delete(realPiece)) {
        this.stats.verifiedBytes = Math.max(
          0,
          this.stats.verifiedBytes - this.realPieceLength(realPiece),
        );
        const startV = Math.floor(
          this.realPieceStart(realPiece) / this.virtualPieceBytes,
        );
        const endV = Math.ceil(
          (this.realPieceStart(realPiece) + this.realPieceLength(realPiece)) /
            this.virtualPieceBytes,
        );
        for (let otherV = startV; otherV < endV; otherV++) {
          if (otherV !== vIdx && this.memPieces.has(otherV)) {
            this.completedVirtualPieces.add(otherV);
          }
        }
      }
      this.memPieces.delete(vIdx);
      this.completedVirtualPieces.delete(vIdx);
      this.completedVirtualBlocks.delete(vIdx);
      this.memUsedBytes -= buf.length;
      freed += buf.length;
    }
    if (freed > 0) this.publishStats();
    return freed;
  }

  async evictDisk(bytesToFree: number, guard: EvictionGuard): Promise<number> {
    if (this.mode !== "disk" || bytesToFree <= 0 || this.closed) return 0;
    if (this.evictPromise) return this.evictPromise;
    const task = (async () => {
      const candidates = this.collectEvictable(
        this.diskSegments.keys(),
        (segIdx) => ({
          start: segIdx * this.segmentBytes,
          end: Math.min(this.metadata.length, (segIdx + 1) * this.segmentBytes),
        }),
        (segIdx) => this.isSegmentBusy(segIdx),
        guard,
      );
      let freed = 0;
      for (const segIdx of candidates) {
        if (freed >= bytesToFree || this.closed) break;
        if (this.isSegmentBusy(segIdx)) continue;
        const size = this.diskSegments.get(segIdx) ?? 0;
        const handle = this.fdPool.get(segIdx);
        if (handle) {
          this.fdPool.delete(segIdx);
          await handle.close().catch(() => {});
        }
        await rm(this.segmentPath(segIdx), { force: true }).catch(() => {});
        this.diskSegments.delete(segIdx);
        freed += size;
        const firstPiece = segIdx * this.piecesPerSegment;
        const lastPiece = Math.min(
          this.metadata.pieces.length,
          (segIdx + 1) * this.piecesPerSegment,
        );
        for (let piece = firstPiece; piece < lastPiece; piece++) {
          if (this.verifiedPieces.delete(piece)) {
            this.stats.verifiedBytes = Math.max(
              0,
              this.stats.verifiedBytes - this.realPieceLength(piece),
            );
          }
          this.clearVirtualTrackingForPiece(piece);
        }
      }
      if (freed > 0 && !this.closed) {
        await this.persistManifest().catch(() => {});
        this.publishStats();
      }
      return freed;
    })();
    this.evictPromise = task;
    try {
      return await task;
    } finally {
      if (this.evictPromise === task) this.evictPromise = null;
    }
  }

  private persistManifest() {
    if (this.mode === "memory" || this.closed) return Promise.resolve();
    const write = async () => {
      if (this.closed) return;
      const manifest: CacheManifest = {
        version: 2,
        infoHash: this.metadata.infoHash,
        pieceLength: this.metadata.pieceLength,
        torrentLength: this.metadata.length,
        segmentBytes: this.segmentBytes,
        verifiedPieces: [...this.verifiedPieces].sort((a, b) => a - b),
      };
      const temporary = `${this.manifestPath}.tmp`;
      await writeFile(temporary, JSON.stringify(manifest), "utf8");
      if (this.closed) {
        await rm(temporary, { force: true }).catch(() => {});
        return;
      }
      await rename(temporary, this.manifestPath);
    };
    this.manifestChain = this.manifestChain.then(write, write);
    return this.manifestChain;
  }

  private async acquireSegmentHandle(
    segIdx: number,
    createIfMissing: boolean,
  ): Promise<FileHandle | null> {
    if (this.closed) throw new Error("torrent cache is closed");
    const cached = this.fdPool.get(segIdx);
    if (cached) {
      this.fdPool.delete(segIdx);
      this.fdPool.set(segIdx, cached);
      return cached;
    }
    const existing = this.pendingOpens.get(segIdx);
    if (existing) {
      const handle = await existing;
      if (handle || !createIfMissing) return handle;
    }
    const task = (async () => {
      if (this.closed) return null;
      const segPath = this.segmentPath(segIdx);
      let handle: FileHandle;
      try {
        handle = await open(segPath, "r+");
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
        if (!createIfMissing) return null;
        handle = await open(segPath, "w+");
      }
      if (this.closed) {
        await handle.close().catch(() => {});
        return null;
      }
      this.fdPool.set(segIdx, handle);
      return handle;
    })();
    this.pendingOpens.set(segIdx, task);
    try {
      return await task;
    } finally {
      if (this.pendingOpens.get(segIdx) === task) {
        this.pendingOpens.delete(segIdx);
      }
    }
  }

  private async trimFdPool() {
    while (this.fdPool.size > MAX_OPEN_SEGMENTS) {
      let evicted = false;
      for (const [segIdx, handle] of this.fdPool) {
        if ((this.activeIo.get(segIdx) ?? 0) > 0) continue;
        this.fdPool.delete(segIdx);
        await handle.close().catch(() => {});
        evicted = true;
        break;
      }
      if (!evicted) break;
    }
  }

  private async withSegmentHandle<T>(
    segIdx: number,
    createIfMissing: boolean,
    fn: (handle: FileHandle | null) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new Error("torrent cache is closed");
    this.activeIo.set(segIdx, (this.activeIo.get(segIdx) ?? 0) + 1);
    try {
      const handle = await this.acquireSegmentHandle(segIdx, createIfMissing);
      if (this.closed) throw new Error("torrent cache is closed");
      return await fn(handle);
    } finally {
      const next = (this.activeIo.get(segIdx) ?? 1) - 1;
      if (next <= 0) this.activeIo.delete(segIdx);
      else this.activeIo.set(segIdx, next);
      if (!this.closed && this.fdPool.size > MAX_OPEN_SEGMENTS) {
        void this.trimFdPool().catch(() => {});
      }
    }
  }

  private async readAt(position: number, length: number) {
    if (!this.opened || this.closed) {
      throw new Error("torrent cache is closed");
    }
    if (length === 0) return Buffer.alloc(0);
    if (this.mode === "memory") {
      const buffer = Buffer.alloc(length);
      let offset = 0;
      while (offset < length) {
        const absPos = position + offset;
        const vIdx = Math.floor(absPos / this.virtualPieceBytes);
        const vOffset = absPos - vIdx * this.virtualPieceBytes;
        const take = Math.min(length - offset, this.virtualPieceBytes - vOffset);
        const pieceBuf = this.memPieces.get(vIdx);
        if (pieceBuf && vOffset < pieceBuf.length) {
          const copyLen = Math.min(take, pieceBuf.length - vOffset);
          pieceBuf.copy(buffer, offset, vOffset, vOffset + copyLen);
        }
        offset += take;
      }
      return buffer;
    }

    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const absPos = position + offset;
      const segIdx = Math.floor(absPos / this.segmentBytes);
      const segOffset = absPos - segIdx * this.segmentBytes;
      const take = Math.min(length - offset, this.segmentBytes - segOffset);
      await this.withSegmentHandle(segIdx, false, async (handle) => {
        if (!handle) return;
        let readPos = 0;
        while (readPos < take) {
          const result = await handle.read(
            buffer,
            offset + readPos,
            take - readPos,
            segOffset + readPos,
          );
          if (!result.bytesRead) break;
          readPos += result.bytesRead;
        }
      });
      offset += take;
    }
    return buffer;
  }

  private async writeAt(position: number, buffer: Buffer) {
    if (!this.opened || this.closed) {
      throw new Error("torrent cache is closed");
    }
    if (buffer.length === 0) return;
    if (this.mode === "memory") {
      let offset = 0;
      while (offset < buffer.length) {
        const absPos = position + offset;
        const vIdx = Math.floor(absPos / this.virtualPieceBytes);
        const vOffset = absPos - vIdx * this.virtualPieceBytes;
        const vLen = this.virtualLength(vIdx);
        const take = Math.min(buffer.length - offset, vLen - vOffset);
        let pieceBuf = this.memPieces.get(vIdx);
        if (!pieceBuf) {
          pieceBuf = Buffer.alloc(vLen);
          this.memPieces.set(vIdx, pieceBuf);
          this.memUsedBytes += vLen;
        }
        buffer.copy(pieceBuf, vOffset, offset, offset + take);
        offset += take;
      }
      return;
    }

    let offset = 0;
    while (offset < buffer.length) {
      const absPos = position + offset;
      const segIdx = Math.floor(absPos / this.segmentBytes);
      const segOffset = absPos - segIdx * this.segmentBytes;
      const take = Math.min(buffer.length - offset, this.segmentBytes - segOffset);
      await this.withSegmentHandle(segIdx, true, async (handle) => {
        if (!handle) throw new Error("torrent cache segment handle unavailable");
        let written = 0;
        while (written < take) {
          const result = await handle.write(
            buffer,
            offset + written,
            take - written,
            segOffset + written,
          );
          written += result.bytesWritten;
        }
        const prev = this.diskSegments.get(segIdx) ?? 0;
        if (segOffset + take > prev) {
          this.diskSegments.set(segIdx, segOffset + take);
        }
      });
      offset += take;
    }
  }

  private publishStats() {
    this.onStats?.(this.getStats());
  }

  async close() {
    this.closed = true;
    await this.evictPromise?.catch(() => {});
    await this.manifestChain.catch(() => {});
    await Promise.allSettled([...this.pendingOpens.values()]);
    const handles = [...this.fdPool.values()];
    this.fdPool.clear();
    await Promise.allSettled(handles.map((handle) => handle.close()));
    this.memPieces.clear();
    this.memUsedBytes = 0;
  }

  async discard() {
    await this.close();
    if (this.mode === "disk") {
      await rm(this.root, { recursive: true, force: true });
    }
  }
}
