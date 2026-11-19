import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createInterface } from "node:readline";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import torrentStream, {
  type TorrentEngine,
  type TorrentFile,
  type TorrentMetadata,
  type TorrentWire,
} from "torrent-stream";
import TrackerClient from "bittorrent-tracker/client";
import DhtClient from "bittorrent-dht/client";

import type {
  TorrentProfile,
  TorrentSession,
  TorrentStartRequest,
  TorrentStatus,
} from "../src/types";
import { REQUEST_BLOCK_BYTES, VirtualCache } from "./virtualCache";

const MAX_CONNECTIONS = 80;
const PEER_SEARCH_MIN = 80;
const PEER_SEARCH_MAX = 250;
const TRACKER_PORT = 6881;
const DHT_LOOKUP_DELAY_MS = 0;
const SWARM_CONNECT_TIMEOUT_MS = 2_000;
const SWARM_HANDSHAKE_TIMEOUT_MS = 8_000;
const WIRE_TIMEOUT_MS = 30_000;
const PEER_WAIT_TIMEOUT_MS = 20_000;
const STREAM_CHUNK_BYTES = 128 * 1024;
const URGENT_WINDOW_BLOCKS = 128;
const SLOW_LANE_OFFSET_BLOCKS = 256;
const FAST_PEER_MIN_BPS = 120 * 1024;
const SLOW_PEER_MAX_BPS = 64 * 1024;
const MIN_ACTIVE_SPEED_BPS = 48 * 1024;
const WIRE_STALL_MS = 1_200;
const HOTSWAP_MIN_AGE_MS = 350;
const WIRE_SILENCE_TIMEOUT_MS = 10_000;
const PUMP_INTERVAL_MS = 200;
const STATUS_THROTTLE_MS = 200;
const IDLE_RECORD_TIMEOUT_MS = 5 * 60_000;
const PROFILE_PREFETCH: Record<
  TorrentProfile,
  { pieces: number; maxQueuePerWire: number; bdpSeconds: number }
> = {
  soft: { pieces: 32, maxQueuePerWire: 40, bdpSeconds: 0.8 },
  default: { pieces: 64, maxQueuePerWire: 80, bdpSeconds: 1.2 },
  fast: { pieces: 96, maxQueuePerWire: 112, bdpSeconds: 1.5 },
  "ultra-fast": { pieces: 128, maxQueuePerWire: 144, bdpSeconds: 2.0 },
};
const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://explodie.org:6969/announce",
  "udp://open.tracker.cl:1337/announce",
  "udp://p4p.arenabg.com:1337/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "udp://tracker.moeking.me:6969/announce",
  "udp://tracker.bittor.pw:1337/announce",
  "http://tracker.qu.ax:6969/announce",
  "https://tracker.opentrackr.org:443/announce",
  "https://tracker.tamersunion.org:443/announce",
];
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024 * 1024;

type WorkerMessage = {
  type: string;
  requestId?: string;
  sessionId?: string;
  request?: TorrentStartRequest;
  discardCache?: boolean;
};

type WorkerResponse = {
  type: "response";
  requestId?: string;
  ok: boolean;
  error?: string;
  session?: Partial<TorrentSession> & {
    streamUrl?: string;
    streamType?: string;
  };
};

type RuntimeSession = {
  sessionId: string;
  request: TorrentStartRequest;
  record: TorrentRecord;
  fileIdx: number | null;
  file: TorrentFile | null;
  state: TorrentStatus["state"];
  firstByte: boolean;
};

async function directorySize(root: string): Promise<number> {
  let total = 0;
  for (const entry of await fs
    .readdir(root, { withFileTypes: true })
    .catch(() => [])) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) total += await directorySize(fullPath);
    else if (entry.isFile()) total += (await fs.stat(fullPath)).size;
  }
  return total;
}

async function enforceCacheLimit(
  root: string,
  maxBytes: number | null,
  active: Set<string>,
) {
  if (maxBytes === null) return;
  await fs.mkdir(root, { recursive: true });
  const entries = await fs
    .readdir(root, { withFileTypes: true })
    .catch(() => []);
  const candidates = [] as Array<{ path: string; size: number; mtime: number }>;
  let total = 0;
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !/^((?:torrent|framezoo-torrent|framezoo-node-torrent)-[a-z0-9_-]{1,128})$/i.test(
        entry.name,
      )
    )
      continue;
    const entryPath = path.join(root, entry.name);
    const size = await directorySize(entryPath);
    total += size;
    if (!active.has(entryPath)) {
      candidates.push({
        path: entryPath,
        size,
        mtime: (await fs.stat(entryPath)).mtimeMs,
      });
    }
  }
  candidates.sort((a, b) => a.mtime - b.mtime);
  for (const candidate of candidates) {
    if (total <= maxBytes) break;
    await fs.rm(candidate.path, { recursive: true, force: true });
    total -= candidate.size;
  }
}

function writeMessage(
  message: WorkerResponse | { type: "status"; status: TorrentStatus },
) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function normalizeTrackers(trackers: string[] | undefined, url?: string) {
  const fromUrl = url
    ? [...url.matchAll(/[?&]tr=([^&]+)/gi)].flatMap((match) => {
        try {
          return [decodeURIComponent(match[1])];
        } catch {
          return [];
        }
      })
    : [];
  const values = [...(trackers ?? []), ...fromUrl, ...DEFAULT_TRACKERS];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim().replace(/^tracker:/i, "");
    if (!/^(?:https?|udp):\/\//i.test(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function isIpv4Peer(address: string) {
  const match = /^([^:]+):(\d+)$/.exec(address.trim());
  if (!match) return false;
  const port = Number(match[2]);
  return net.isIP(match[1]) === 4 && port > 0 && port < 65536;
}

function createPeerId() {
  const prefix = ["qB4600", "DE2110", "AZ5770", "TR4040"]
    [randomBytes(1)[0]! % 4]!.split("")
    .map((char) => {
      if (!/\d/.test(char)) return char;
      const value = Number(char);
      if (value === 0) return char;
      const min = Math.floor(value / 2);
      return String(min + (randomBytes(1)[0]! % (value - min + 1)));
    })
    .join("");
  return `-${prefix}-${randomBytes(6).toString("hex")}`;
}

type PeerSource = {
  start(): void;
  pause(): void;
  close(): void;
};

/** Small PeerSearch clone matching Stremio's bounded discovery behavior. */
class PeerSearch {
  private readonly sources: PeerSource[] = [];
  private readonly seen = new Set<string>();
  private readonly dht: DhtClient;
  private dhtAbort: (() => void) | null = null;
  private dhtTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private closed = false;

  constructor(
    private readonly infoHash: string,
    peerId: string,
    port: number,
    trackers: string[],
    private readonly swarm: TorrentEngine["swarm"],
    private readonly onChanged: () => void,
  ) {
    const addPeer = (address: string) => {
      if (this.closed || !isIpv4Peer(address) || this.seen.has(address)) return;
      if (this.swarm.queued >= PEER_SEARCH_MAX) {
        this.update();
        return;
      }
      this.seen.add(address);
      this.swarm.add(address);
      this.update();
    };

    for (const tracker of trackers) {
      try {
        const client = new TrackerClient(
          Buffer.from(peerId),
          port || TRACKER_PORT,
          {
            infoHash: this.infoHash,
            announce: [tracker],
          },
        );
        client.on("peer", addPeer);
        client.on("warning", this.onChanged);
        client.on("error", this.onChanged);
        this.sources.push({
          start: () => client.start(),
          pause: () => client.stop(),
          close: () => client.destroy(),
        });
      } catch {
        this.onChanged();
      }
    }

    this.dht = new DhtClient({ concurrency: 10 });
    this.dht.on(
      "peer",
      (peer: { host: string; port: number }, hash: Buffer) => {
        if (hash.toString("hex") === this.infoHash)
          addPeer(`${peer.host}:${peer.port}`);
      },
    );
    this.dht.on("warning", this.onChanged);
    this.dht.on("error", this.onChanged);
    this.sources.push({
      start: () => {
        if (this.dhtTimer || this.dhtAbort) return;
        this.dhtTimer = setTimeout(() => {
          this.dhtTimer = null;
          this.dhtAbort = this.dht.lookup(this.infoHash);
        }, DHT_LOOKUP_DELAY_MS);
        this.dhtTimer.unref();
      },
      pause: () => {
        if (this.dhtTimer) clearTimeout(this.dhtTimer);
        this.dhtTimer = null;
        this.dhtAbort?.();
        this.dhtAbort = null;
      },
      close: () => {
        if (this.dhtTimer) clearTimeout(this.dhtTimer);
        this.dhtTimer = null;
        this.dhtAbort?.();
        this.dhtAbort = null;
        this.dht.destroy();
      },
    });

    this.swarm.on("wire", this.update);
    this.swarm.on("wire-disconnect", this.update);
    this.swarm.on("resume", this.update);
    this.swarm.on("pause", this.update);
    this.run();
  }

  private readonly update = () => {
    if (this.closed) return;
    if (this.swarm.paused) {
      if (this.running) this.pause();
    } else if (this.swarm.queued < PEER_SEARCH_MIN && !this.running) {
      this.run();
    } else if (this.swarm.queued > PEER_SEARCH_MAX && this.running) {
      this.pause();
    }
    this.onChanged();
  };

  private run() {
    if (this.closed || this.running) return;
    this.running = true;
    for (const source of this.sources) source.start();
  }

  private pause() {
    if (!this.running) return;
    this.running = false;
    for (const source of this.sources) source.pause();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.pause();
    for (const source of this.sources) source.close();
    this.sources.length = 0;
  }
}

function extractInfoHash(url: string | undefined) {
  if (!url) return null;
  const match = url.match(/urn:btih:([^&]+)/i);
  if (!match) return null;
  const value = decodeURIComponent(match[1]).trim();
  if (/^[0-9a-f]{40}$/i.test(value)) return value.toLowerCase();
  return null;
}

function getPeerPiece(wire: TorrentWire, piece: number) {
  if (!wire.peerPieces) return false;
  if (typeof wire.peerPieces === "object" && "get" in wire.peerPieces) {
    return wire.peerPieces.get(piece);
  }
  return Boolean(wire.peerPieces[piece]);
}

/** Adaptive BDP target queue depth per wire based on measured throughput. */
export function computeWireTargetQueue(
  blocksDone: number,
  speedBps: number,
  maxQueuePerWire: number,
  bdpSeconds: number,
): number {
  if (blocksDone === 0) return 4;
  if (speedBps < MIN_ACTIVE_SPEED_BPS) return 2;
  return Math.max(
    8,
    Math.min(
      maxQueuePerWire,
      Math.ceil((speedBps * bdpSeconds) / REQUEST_BLOCK_BYTES),
    ),
  );
}

/** True when an in-flight urgent block should be hedged onto a healthier wire. */
export function shouldHotswapBlock(
  now: number,
  reqSentAt: number,
  ownerLastDataAt: number,
  ownerSpeedBps: number,
  candidateSpeedBps: number,
): boolean {
  const wireStalled = now - Math.max(ownerLastDataAt, reqSentAt) > WIRE_STALL_MS;
  const fasterTakeover =
    now - reqSentAt > HOTSWAP_MIN_AGE_MS &&
    candidateSpeedBps >= FAST_PEER_MIN_BPS &&
    candidateSpeedBps > ownerSpeedBps * 2;
  return wireStalled || fasterTakeover;
}

/** Stremio-style continuous read-ahead to EOF unless cache limit is reached or disabled. */
export function computePrefetchEnd(
  fromVirtual: number,
  fileLastVirtual: number,
  profilePieces: number,
  maxBytes: number | null,
  cachedFileBytes: number,
): number {
  if (maxBytes === 0 || (maxBytes !== null && cachedFileBytes >= maxBytes)) {
    return Math.min(fileLastVirtual, fromVirtual + profilePieces - 1);
  }
  return fileLastVirtual;
}

export function isPrefetchSeek(
  sameFile: boolean,
  fromVirtual: number,
  windowStart: number,
  frontier: number,
): boolean {
  return (
    !sameFile ||
    fromVirtual < windowStart ||
    fromVirtual > Math.max(windowStart, frontier) + 2
  );
}

function getContentType(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  return (
    (
      {
        ".m4v": "video/mp4",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mkv": "video/x-matroska",
        ".avi": "video/x-msvideo",
        ".mov": "video/quicktime",
      } as Record<string, string>
    )[extension] ?? "application/octet-stream"
  );
}

function parseRange(value: string | undefined, size: number) {
  if (!value) return { start: 0, end: Math.max(0, size - 1) };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match) return null;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2] || 0));
  const end = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

function localOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (!origin || origin === "null") return origin ?? null;
  try {
    const parsed = new URL(origin);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) &&
      ["http:", "https:"].includes(parsed.protocol)
      ? origin
      : null;
  } catch {
    return null;
  }
}

function cors(request: IncomingMessage, response: ServerResponse) {
  const origin = localOrigin(request);
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Range, Content-Type, Accept, Origin",
  );
  response.setHeader(
    "Access-Control-Expose-Headers",
    "Accept-Ranges, Content-Length, Content-Range",
  );
  response.setHeader("Accept-Ranges", "bytes");
}

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

type WireState = {
  hist: Array<[number, number]>;
  lastBlockAt: number;
  blocksDone: number;
};

type InFlightBlock = {
  wire: TorrentWire;
  sentAt: number;
  hedged: boolean;
};

class TorrentRecord {
  readonly infoHash: string;
  readonly cachePath: string;
  readonly engine: TorrentEngine;
  readonly peerId: string;
  metadata: TorrentMetadata | null = null;
  cache: VirtualCache | null = null;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readonly readyPromise: Promise<void>;
  private readyError: Error | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private peerSearch: PeerSearch | null = null;
  private totalDownloaded = 0;
  private startedAt = Date.now();
  private readonly onChanged: () => void;
  private readonly cacheName: string;
  private prefetchProfile: {
    pieces: number;
    maxQueuePerWire: number;
    bdpSeconds: number;
  };
  private maxBytes: number | null;
  private activeFile: TorrentFile | null = null;
  private playheadBlock = 0;
  private fastCursor = 0;
  private slowCursor = 0;
  private prefetchWindowStartVirtual = -1;
  private prefetchFrontierVirtual = -1;
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private readonly activeReads = new Set<{ startBlock: number; endBlock: number }>();
  private readonly inFlightBlocks = new Map<number, InFlightBlock>();
  private readonly blockWaiters = new Map<number, Set<() => void>>();
  private readonly wireStates = new WeakMap<TorrentWire, WireState>();

  constructor(
    private readonly request: TorrentStartRequest,
    private readonly cacheRoot: string,
    onChanged: () => void,
  ) {
    this.infoHash =
      (request.infoHash ?? extractInfoHash(request.url))?.toLowerCase() ??
      request.url;
    this.peerId = createPeerId();
    this.cacheName = this.infoHash.replace(/[^a-z0-9_-]/gi, "_");
    this.onChanged = onChanged;
    this.prefetchProfile =
      PROFILE_PREFETCH[request.torrentProfile ?? "default"] ??
      PROFILE_PREFETCH.default;
    this.maxBytes = request.maxBytes ?? DEFAULT_MAX_BYTES;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    const root = path.join(
      cacheRoot,
      `framezoo-node-torrent-${this.cacheName}`,
    );
    this.cachePath = root;
    const enginePath = path.join(root, "engine");
    this.engine = torrentStream(request.url, {
      path: enginePath,
      // Keep torrent-stream's metadata file inside the Node cache namespace.
      tmp: path.join(root, "metadata"),
      id: this.peerId,
      trackers: normalizeTrackers(request.trackers, request.url),
      connections: MAX_CONNECTIONS,
      timeout: WIRE_TIMEOUT_MS,
      // Bootstrap magnet metadata before the post-ready bounded peer search.
      dht: true,
      tracker: true,
      uploads: 0,
      verify: false,
    });
    this.engine.swarm.connectTimeout = SWARM_CONNECT_TIMEOUT_MS;
    this.engine.swarm.handshakeTimeout = SWARM_HANDSHAKE_TIMEOUT_MS;

    this.engine.on("ready", () => {
      void this.initializeMetadata();
    });
    this.engine.on("wire", (wire: TorrentWire) => {
      this.keepInterested(wire);
      wire.on("unchoke", () => this.pumpWire(wire));
      wire.on("choke", () => this.keepInterested(wire));
      wire.on("bitfield", () => {
        this.keepInterested(wire);
        this.pumpWire(wire);
      });
      wire.on("have", () => {
        this.keepInterested(wire);
        this.pumpWire(wire);
      });
      wire.on("close", this.onChanged);
      this.onChanged();
    });
    this.engine.on("peer", (peer: string) => {
      this.onChanged();
    });
    this.engine.on("error", (error: Error) => {
      if (!this.metadata) {
        this.readyError = error;
        this.readyReject(error);
      }
      this.onChanged();
    });
    this.engine.on("download", (bytes: number) => {
      this.totalDownloaded += Number(bytes) || 0;
      this.onChanged();
    });
    for (const peer of (process.env.FRAMEZOO_TORRENT_PEERS ?? "").split(",")) {
      const address = peer.trim();
      if (address) this.engine.connect?.(address);
    }
    void this.listen();
  }

  private async listen() {
    try {
      const port = await freePort();
      await new Promise<void>((resolve, reject) => {
        this.engine.listen(port, (error) =>
          error ? reject(error) : resolve(),
        );
      });
      this.peerSearch = new PeerSearch(
        this.infoHash,
        this.peerId,
        port,
        normalizeTrackers(this.request.trackers, this.request.url),
        this.engine.swarm,
        this.onChanged,
      );
      this.onChanged();
    } catch (error) {
      process.stderr.write(`[torrent-node] listen failed: ${String(error)}\n`);
    }
  }

  private async initializeMetadata() {
    if (this.metadata) return;
    const metadata = this.engine.torrent;
    if (!metadata) {
      const error = new Error("torrent engine reported ready without metadata");
      this.readyError = error;
      this.readyReject(error);
      return;
    }
    this.metadata = metadata;
    const cachePath = path.join(
      this.cacheRoot,
      `framezoo-node-torrent-${this.cacheName}`,
    );
    this.cache = new VirtualCache(cachePath, metadata, (stats) => {
      this.totalDownloaded = Math.max(
        this.totalDownloaded,
        stats.downloadedBytes,
      );
      this.onChanged();
    });
    try {
      await this.cache.open();
      this.readyResolve();
      // Re-assert interest right after torrent-stream's post-ready refresh().
      setTimeout(() => {
        for (const wire of this.engine.swarm.wires) {
          this.keepInterested(wire);
        }
        this.pumpAllWires();
      }, 10).unref();
      this.onChanged();
    } catch (error) {
      this.readyError =
        error instanceof Error ? error : new Error(String(error));
      this.readyReject(this.readyError);
      this.onChanged();
    }
  }

  async ready() {
    if (this.readyError) throw this.readyError;
    return Promise.race([
      this.readyPromise,
      delay(PEER_WAIT_TIMEOUT_MS).then(() => {
        throw new Error("torrent metadata discovery timed out");
      }),
    ]);
  }

  scheduleIdleDestroy(onDestroy: () => Promise<void>) {
    this.stopPrefetch();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void onDestroy(), IDLE_RECORD_TIMEOUT_MS);
    this.idleTimer.unref();
  }

  cancelIdleDestroy() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  peerCount() {
    return this.engine.swarm.wires.length;
  }

  speed() {
    return Math.max(0, Number(this.engine.swarm.downloadSpeed()) || 0);
  }

  downloadedBytes() {
    return this.totalDownloaded;
  }

  progress(file: TorrentFile | null) {
    const total = file?.length ?? this.metadata?.length ?? 0;
    if (!total || !this.cache) return 0;
    return Math.min(
      100,
      (this.cache.cachedBytesInRange(file?.offset ?? 0, total) / total) * 100,
    );
  }

  configure(profile?: TorrentProfile, maxBytes?: number | null) {
    this.prefetchProfile =
      PROFILE_PREFETCH[profile ?? "default"] ?? PROFILE_PREFETCH.default;
    if (maxBytes !== undefined) {
      this.maxBytes = maxBytes;
    }
  }

  private getWireState(wire: TorrentWire): WireState {
    let state = this.wireStates.get(wire);
    if (!state) {
      state = { hist: [], lastBlockAt: 0, blocksDone: 0 };
      this.wireStates.set(wire, state);
    }
    return state;
  }

  private keepInterested(wire: TorrentWire) {
    if (!wire.amInterested && !wire._finished) {
      wire.interested?.();
    }
  }

  private wireSpeed3s(wire: TorrentWire, now = Date.now()): number {
    const state = this.wireStates.get(wire);
    const engineSpeed = Math.max(0, Number(wire.downloadSpeed?.()) || 0);
    if (!state?.hist.length) return engineSpeed;
    while (state.hist.length && now - state.hist[0]![0] > 3_000) {
      state.hist.shift();
    }
    if (!state.hist.length) return engineSpeed;
    let sum = 0;
    for (const [, bytes] of state.hist) sum += bytes;
    const span = Math.max(0.5, (now - state.hist[0]![0]) / 1_000);
    return Math.max(engineSpeed, sum / span);
  }

  private hasFastPeer(now = Date.now()): boolean {
    return this.engine.swarm.wires.some(
      (wire) =>
        !wire.peerChoking &&
        !wire._finished &&
        this.wireSpeed3s(wire, now) >= FAST_PEER_MIN_BPS,
    );
  }

  private cancelInFlightBlock(bIdx: number, entry: InFlightBlock) {
    if (this.metadata) {
      const absPos = bIdx * REQUEST_BLOCK_BYTES;
      const piece = Math.floor(absPos / this.metadata.pieceLength);
      const offset = absPos - piece * this.metadata.pieceLength;
      const len = Math.min(REQUEST_BLOCK_BYTES, this.metadata.length - absPos);
      entry.wire.cancel?.(piece, offset, len);
    }
    if (this.inFlightBlocks.get(bIdx) === entry) {
      this.inFlightBlocks.delete(bIdx);
    }
  }

  private wakeBlockWaiters(bIdx: number) {
    const waiters = this.blockWaiters.get(bIdx);
    if (!waiters) return;
    for (const notify of [...waiters]) notify();
  }

  private pickUrgentBlock(
    wire: TorrentWire,
    rangeStart: number,
    rangeEnd: number,
    mySpeed: number,
    now: number,
  ): number {
    const pieceLength = this.metadata!.pieceLength;
    for (let b = rangeStart; b <= rangeEnd; b++) {
      if (this.cache!.hasBlock(b)) continue;
      const piece = Math.floor((b * REQUEST_BLOCK_BYTES) / pieceLength);
      if (!getPeerPiece(wire, piece)) continue;
      const existing = this.inFlightBlocks.get(b);
      if (!existing) return b;
      if (existing.wire !== wire && !existing.hedged) {
        const ownerState = this.wireStates.get(existing.wire);
        if (
          shouldHotswapBlock(
            now,
            existing.sentAt,
            ownerState?.lastBlockAt ?? 0,
            this.wireSpeed3s(existing.wire, now),
            mySpeed,
          )
        ) {
          existing.hedged = true;
          return b;
        }
      }
    }
    return -1;
  }

  private pumpWire(wire: TorrentWire) {
    if (!this.metadata || !this.cache || !this.activeFile || wire._finished) {
      return;
    }
    this.keepInterested(wire);
    if (wire.peerChoking) return;

    const now = Date.now();
    const state = this.getWireState(wire);
    const mySpeed = this.wireSpeed3s(wire, now);
    const cap = computeWireTargetQueue(
      state.blocksDone,
      mySpeed,
      this.prefetchProfile.maxQueuePerWire,
      this.prefetchProfile.bdpSeconds,
    );
    const slow = state.blocksDone > 0 && mySpeed < SLOW_PEER_MAX_BPS;
    const anyFast = this.hasFastPeer(now);
    const file = this.activeFile;
    const pieceLength = this.metadata.pieceLength;
    const vBytes = this.cache.virtualPieceBytes;
    const fileFirstBlock = Math.floor(file.offset / REQUEST_BLOCK_BYTES);
    const fileLastBlock = Math.floor(
      (file.offset + Math.max(1, file.length) - 1) / REQUEST_BLOCK_BYTES,
    );
    const fileLastVirtual = Math.floor(
      (file.offset + Math.max(1, file.length) - 1) / vBytes,
    );
    const cachedFileBytes =
      this.maxBytes !== null && this.maxBytes > 0
        ? this.cache.cachedBytesInRange(file.offset, file.length)
        : 0;
    const effectiveEndVirtual = computePrefetchEnd(
      Math.max(0, this.prefetchWindowStartVirtual),
      fileLastVirtual,
      this.prefetchProfile.pieces,
      this.maxBytes,
      cachedFileBytes,
    );
    const prefetchEndBlock = Math.min(
      fileLastBlock,
      Math.floor(
        ((effectiveEndVirtual + 1) * vBytes - 1) / REQUEST_BLOCK_BYTES,
      ),
    );

    let sent = 0;
    while ((wire.requests?.length ?? 0) < cap && sent < cap) {
      let picked = -1;

      // Priority 0: active HTTP readers (header, EOF cues, current stream chunk).
      if (!slow || !anyFast) {
        for (const read of this.activeReads) {
          picked = this.pickUrgentBlock(
            wire,
            Math.max(fileFirstBlock, read.startBlock),
            Math.min(fileLastBlock, read.endBlock),
            mySpeed,
            now,
          );
          if (picked >= 0) break;
        }
      }

      // Priority 1: urgent playhead buffer (next 2 MiB).
      if (picked < 0 && (!slow || !anyFast)) {
        const urgentStart = Math.max(fileFirstBlock, this.playheadBlock);
        const urgentEnd = Math.min(
          fileLastBlock,
          urgentStart + URGENT_WINDOW_BLOCKS,
        );
        picked = this.pickUrgentBlock(wire, urgentStart, urgentEnd, mySpeed, now);
      }

      // Priority 2: continuous sequential read-ahead (fast/slow lanes).
      if (picked < 0) {
        const slowLane = slow && anyFast;
        let scan = slowLane
          ? Math.max(
              this.slowCursor,
              this.playheadBlock + SLOW_LANE_OFFSET_BLOCKS,
            )
          : Math.max(this.fastCursor, this.playheadBlock);
        const scanLimit = Math.min(prefetchEndBlock, scan + 16_384);
        let contiguous = true;
        while (scan <= scanLimit) {
          const piece = Math.floor((scan * REQUEST_BLOCK_BYTES) / pieceLength);
          if (!getPeerPiece(wire, piece)) {
            contiguous = false;
            scan = Math.ceil(((piece + 1) * pieceLength) / REQUEST_BLOCK_BYTES);
            continue;
          }
          if (!this.cache.hasBlock(scan) && !this.inFlightBlocks.has(scan)) {
            picked = scan;
            if (contiguous) {
              if (slowLane) this.slowCursor = scan + 1;
              else this.fastCursor = scan + 1;
            }
            break;
          }
          scan++;
          if (contiguous) {
            if (slowLane) this.slowCursor = scan;
            else this.fastCursor = scan;
          }
        }
      }

      if (picked < 0) break;

      const absPos = picked * REQUEST_BLOCK_BYTES;
      const piece = Math.floor(absPos / pieceLength);
      const pieceOffset = absPos - piece * pieceLength;
      const len = Math.min(REQUEST_BLOCK_BYTES, this.metadata.length - absPos);
      if (!this.inFlightBlocks.has(picked)) {
        this.inFlightBlocks.set(picked, { wire, sentAt: now, hedged: false });
      }
      const bIdx = picked;
      sent++;
      wire.request(piece, pieceOffset, len, (error, block) => {
        const cur = this.inFlightBlocks.get(bIdx);
        if (cur && cur.wire === wire) {
          this.inFlightBlocks.delete(bIdx);
        }
        if (!error && block && block.length === len && this.cache) {
          const doneAt = Date.now();
          const wireState = this.getWireState(wire);
          wireState.hist.push([doneAt, len]);
          wireState.lastBlockAt = doneAt;
          wireState.blocksDone++;
          void this.cache
            .commitBlock(bIdx, block)
            .then(() => this.wakeBlockWaiters(bIdx))
            .catch(() => {});
          process.nextTick(() => this.pumpWire(wire));
        }
      });
    }
  }

  private pumpAllWires() {
    if (!this.metadata || !this.cache || !this.activeFile) return;
    const now = Date.now();
    for (const [bIdx, entry] of [...this.inFlightBlocks]) {
      const state = this.wireStates.get(entry.wire);
      const lastActive = Math.max(state?.lastBlockAt ?? 0, entry.sentAt);
      if (
        entry.wire._finished ||
        entry.wire.peerChoking ||
        now - lastActive > WIRE_SILENCE_TIMEOUT_MS
      ) {
        this.cancelInFlightBlock(bIdx, entry);
      }
    }
    for (const wire of this.engine.swarm.wires) {
      this.pumpWire(wire);
    }
  }

  private setPlaybackPosition(file: TorrentFile, startBlock: number) {
    if (!this.cache || !this.metadata) return;
    const vIdx = Math.floor(
      (startBlock * REQUEST_BLOCK_BYTES) / this.cache.virtualPieceBytes,
    );
    if (
      isPrefetchSeek(
        this.activeFile === file,
        vIdx,
        this.prefetchWindowStartVirtual,
        this.prefetchFrontierVirtual,
      )
    ) {
      for (const [bIdx, entry] of [...this.inFlightBlocks]) {
        if (bIdx < startBlock || bIdx > startBlock + URGENT_WINDOW_BLOCKS) {
          this.cancelInFlightBlock(bIdx, entry);
        }
      }
      this.fastCursor = startBlock;
      this.slowCursor = startBlock + SLOW_LANE_OFFSET_BLOCKS;
      this.prefetchFrontierVirtual = vIdx;
    }
    this.activeFile = file;
    this.playheadBlock = startBlock;
    this.prefetchWindowStartVirtual = vIdx;
    this.prefetchFrontierVirtual = Math.max(this.prefetchFrontierVirtual, vIdx);
    if (!this.pumpTimer) {
      this.pumpTimer = setInterval(
        () => this.pumpAllWires(),
        PUMP_INTERVAL_MS,
      );
      this.pumpTimer.unref();
    }
    this.pumpAllWires();
  }

  private stopPrefetch() {
    if (this.pumpTimer) {
      clearInterval(this.pumpTimer);
      this.pumpTimer = null;
    }
    for (const [bIdx, entry] of [...this.inFlightBlocks]) {
      this.cancelInFlightBlock(bIdx, entry);
    }
    this.activeFile = null;
    this.playheadBlock = 0;
    this.fastCursor = 0;
    this.slowCursor = 0;
    this.prefetchWindowStartVirtual = -1;
    this.prefetchFrontierVirtual = -1;
  }

  private waitForBlocks(
    startBlock: number,
    endBlock: number,
    signal: AbortSignal,
  ): Promise<void> {
    const cache = this.cache!;
    const allReady = () => {
      for (let b = startBlock; b <= endBlock; b++) {
        if (!cache.hasBlock(b)) return false;
      }
      return true;
    };
    if (allReady()) return Promise.resolve();
    if (signal.aborted) {
      return Promise.reject(new Error("torrent range request aborted"));
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const entry = { startBlock, endBlock };
      const watched = new Set<number>();

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        timeout = null;
        signal.removeEventListener("abort", onAbort);
        this.activeReads.delete(entry);
        for (const b of watched) {
          const set = this.blockWaiters.get(b);
          if (!set) continue;
          set.delete(check);
          if (!set.size) this.blockWaiters.delete(b);
        }
        watched.clear();
      };

      const resetTimer = () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(
            new Error(
              `timed out waiting for torrent blocks ${startBlock}-${endBlock}`,
            ),
          );
        }, PEER_WAIT_TIMEOUT_MS);
        timeout.unref();
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("torrent range request aborted"));
      };

      const check = () => {
        if (settled) return;
        if (allReady()) {
          settled = true;
          cleanup();
          resolve();
          return;
        }
        resetTimer();
      };

      for (let b = startBlock; b <= endBlock; b++) {
        if (cache.hasBlock(b)) continue;
        watched.add(b);
        let set = this.blockWaiters.get(b);
        if (!set) {
          set = new Set();
          this.blockWaiters.set(b, set);
        }
        set.add(check);
      }

      this.activeReads.add(entry);
      signal.addEventListener("abort", onAbort, { once: true });
      resetTimer();
      this.pumpAllWires();
      check();
    });
  }

  async *readRange(
    file: TorrentFile,
    start: number,
    end: number,
    signal: AbortSignal,
  ) {
    if (!this.metadata || !this.cache) await this.ready();
    if (!this.metadata || !this.cache)
      throw new Error("torrent metadata unavailable");

    const absoluteStart = file.offset + start;
    const absoluteEnd = file.offset + end;
    let cursor = absoluteStart;
    while (cursor <= absoluteEnd) {
      if (signal.aborted) throw new Error("torrent range request aborted");
      const chunkLen = Math.min(STREAM_CHUNK_BYTES, absoluteEnd - cursor + 1);
      const needStartBlock = Math.floor(cursor / REQUEST_BLOCK_BYTES);
      const needEndBlock = Math.floor(
        (cursor + chunkLen - 1) / REQUEST_BLOCK_BYTES,
      );
      this.setPlaybackPosition(file, needStartBlock);
      await this.waitForBlocks(needStartBlock, needEndBlock, signal);
      yield await this.cache.readRange(cursor, chunkLen);
      cursor += chunkLen;
    }
  }

  async destroy(discardCache: boolean) {
    this.cancelIdleDestroy();
    this.stopPrefetch();
    this.peerSearch?.close();
    this.peerSearch = null;
    await new Promise<void>((resolve) => this.engine.destroy(() => resolve()));
    if (discardCache) await this.cache?.discard();
    else await this.cache?.close();
  }
}

class TorrentWorker {
  private readonly records = new Map<string, TorrentRecord>();
  private readonly sessions = new Map<string, RuntimeSession>();
  private server: ReturnType<typeof createServer> | null = null;
  private baseUrl = "";
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStatusEmitAt = 0;

  async startServer() {
    this.server = createServer((request, response) => {
      void this.handleHttp(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("torrent HTTP server failed to bind");
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async start(request: TorrentStartRequest, requestedSessionId?: string) {
    if (!request.url) throw new Error("torrent URL is required");
    const maxBytes = request.maxBytes ?? DEFAULT_MAX_BYTES;
    if (
      maxBytes !== null &&
      (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    ) {
      throw new Error(
        "torrent cache size must be a non-negative integer or null",
      );
    }
    const cacheRoot = request.cacheRoot
      ? path.join(request.cacheRoot, "Framezoo", "torrents")
      : process.env.FRAMEZOO_TORRENT_DATA_DIR ||
        path.join(os.tmpdir(), "framezoo-torrents");
    const key = `${(request.infoHash ?? extractInfoHash(request.url) ?? request.url).toLowerCase()}::${cacheRoot}`;
    let record = this.records.get(key);
    if (!record) {
      await enforceCacheLimit(
        cacheRoot,
        maxBytes,
        new Set([...this.records.values()].map((item) => item.cachePath)),
      );
      record = new TorrentRecord(request, cacheRoot, () => this.emitStatuses());
      this.records.set(key, record);
    }
    record.configure(request.torrentProfile, maxBytes);
    record.cancelIdleDestroy();
    const sessionId =
      requestedSessionId ?? `torrent-${randomBytes(12).toString("hex")}`;
    const session: RuntimeSession = {
      sessionId,
      request,
      record,
      fileIdx: Number.isInteger(request.fileIdx) ? request.fileIdx! : null,
      file: null,
      state: "starting",
      firstByte: false,
    };
    this.sessions.set(sessionId, session);
    this.emitStatus(session);
    return {
      sessionId,
      sourceId: request.sourceId,
      streamUrl: `${this.baseUrl}/torrent/${encodeURIComponent(sessionId)}`,
      streamType: "pending",
      startAt: request.startAt ?? 0,
      duration: request.duration ?? null,
      fileName: request.fileName ?? null,
      infoHash: record.infoHash,
    } satisfies Partial<TorrentSession> & {
      streamUrl: string;
      streamType: string;
    };
  }

  async stop(sessionId: string, discardCache: boolean) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    session.state = "stopped";
    this.emitStatus(session);
    const hasOtherSession = [...this.sessions.values()].some(
      (item) => item.record === session.record,
    );
    if (!hasOtherSession) {
      if (discardCache) {
        for (const [key, record] of this.records) {
          if (record !== session.record) continue;
          this.records.delete(key);
        }
        await session.record.destroy(true);
        return;
      }
      session.record.scheduleIdleDestroy(async () => {
        this.records.forEach((record, key) => {
          if (record === session.record) this.records.delete(key);
        });
        await session.record.destroy(discardCache);
      });
    }
  }

  async stopAll(discardCache: boolean) {
    const records = [...this.records.values()];
    this.sessions.clear();
    this.records.clear();
    await Promise.allSettled(
      records.map((record) => record.destroy(discardCache)),
    );
  }

  getStatus(sessionId: string) {
    const session = this.sessions.get(sessionId);
    return session ? this.status(session) : null;
  }

  async handleHttp(request: IncomingMessage, response: ServerResponse) {
    cors(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    const match = /^\/torrent\/([^/]+)$/.exec(
      (request.url ?? "").split("?", 1)[0],
    );
    const session = match
      ? this.sessions.get(decodeURIComponent(match[1]))
      : undefined;
    if (!session || (request.method !== "GET" && request.method !== "HEAD")) {
      response.writeHead(session ? 405 : 404);
      response.end();
      return;
    }
    const abort = new AbortController();
    const cancel = () => abort.abort();
    request.on("close", cancel);
    response.on("close", cancel);
    try {
      await session.record.ready();
      const metadata = session.record.metadata;
      if (!metadata) throw new Error("torrent metadata unavailable");
      if (session.state === "starting") {
        session.state = "buffering";
        this.emitStatus(session);
      }
      session.file = this.resolveFile(session, metadata);
      if (!session.file) throw new Error("torrent video file not found");
      const range = parseRange(request.headers.range, session.file.length);
      if (!range) {
        response.writeHead(416, {
          "Content-Range": `bytes */${session.file.length}`,
        });
        response.end();
        return;
      }
      const length = range.end - range.start + 1;
      response.setHeader(
        "Content-Type",
        getContentType(session.file.name ?? session.file.path ?? "video.mkv"),
      );
      response.setHeader("Content-Length", length);
      response.setHeader("Cache-Control", "no-store");
      if (request.method === "HEAD") {
        response.writeHead(
          request.headers.range ? 206 : 200,
          request.headers.range
            ? {
                "Content-Range": `bytes ${range.start}-${range.end}/${session.file.length}`,
              }
            : undefined,
        );
        response.end();
        return;
      }
      response.statusCode = request.headers.range ? 206 : 200;
      if (request.headers.range)
        response.setHeader(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${session.file.length}`,
        );
      response.flushHeaders();
      for await (const chunk of session.record.readRange(
        session.file,
        range.start,
        range.end,
        abort.signal,
      )) {
        if (abort.signal.aborted || response.destroyed) return;
        if (!session.firstByte) {
          session.firstByte = true;
          session.state = "ready";
          this.emitStatus(session);
        }
        if (!response.write(chunk)) {
          await new Promise<void>((resolve) => {
            const done = () => {
              response.off("drain", done);
              response.off("close", done);
              abort.signal.removeEventListener("abort", done);
              resolve();
            };
            response.once("drain", done);
            response.once("close", done);
            abort.signal.addEventListener("abort", done, { once: true });
          });
        }
      }
      response.end();
    } catch (error) {
      if (!abort.signal.aborted && !response.headersSent) {
        session.state = "error";
        this.emitStatus(
          session,
          error instanceof Error ? error.message : String(error),
        );
        response.writeHead(502);
        response.end();
      }
    }
  }

  private resolveFile(session: RuntimeSession, metadata: TorrentMetadata) {
    if (session.fileIdx !== null && metadata.files[session.fileIdx])
      return metadata.files[session.fileIdx];
    const video = metadata.files
      .filter((file) =>
        /\.(?:mkv|mp4|m4v|webm|avi|mov)$/i.test(file.name ?? file.path ?? ""),
      )
      .sort((a, b) => b.length - a.length)[0];
    return (
      video ??
      [...metadata.files].sort((a, b) => b.length - a.length)[0] ??
      null
    );
  }

  private status(
    session: RuntimeSession,
    error: string | null = null,
  ): TorrentStatus {
    const file = session.file;
    const record = session.record;
    const totalBytes = file?.length ?? record.metadata?.length ?? null;
    return {
      sessionId: session.sessionId,
      sourceId: session.request.sourceId,
      state: session.state,
      progress: record.progress(file),
      speedBytesPerSecond: record.speed(),
      peers: record.peerCount(),
      infoHash: record.infoHash,
      fileName: file?.name ?? file?.path ?? session.request.fileName ?? null,
      downloadedBytes: record.downloadedBytes(),
      totalBytes,
      streamType:
        session.state === "starting" || session.state === "buffering"
          ? "pending"
          : "file",
      streamUrl:
        session.state === "error" || session.state === "stopped"
          ? null
          : `${this.baseUrl}/torrent/${encodeURIComponent(session.sessionId)}`,
      startAt: session.request.startAt ?? 0,
      duration: session.request.duration ?? null,
      error,
      updatedAt: Date.now(),
      discoveryPhase: record.peerCount() ? "peers-connected" : "discovering",
      peersDiscovered: record.peerCount(),
      dhtRunning: true,
    };
  }

  private emitStatus(session: RuntimeSession, error: string | null = null) {
    writeMessage({ type: "status", status: this.status(session, error) });
  }

  private emitStatuses() {
    const now = Date.now();
    const elapsed = now - this.lastStatusEmitAt;
    if (elapsed >= STATUS_THROTTLE_MS) {
      if (this.statusTimer) {
        clearTimeout(this.statusTimer);
        this.statusTimer = null;
      }
      this.lastStatusEmitAt = now;
      for (const session of this.sessions.values()) this.emitStatus(session);
      return;
    }
    if (!this.statusTimer) {
      this.statusTimer = setTimeout(() => {
        this.statusTimer = null;
        this.lastStatusEmitAt = Date.now();
        for (const session of this.sessions.values()) this.emitStatus(session);
      }, STATUS_THROTTLE_MS - elapsed);
      this.statusTimer.unref();
    }
  }

  async dispose() {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    await this.stopAll(true);
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = null;
  }
}

async function main() {
  const worker = new TorrentWorker();
  await worker.startServer();
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    void (async () => {
      if (!line.trim()) return;
      const message = JSON.parse(line) as WorkerMessage;
      try {
        if (message.type === "start" && message.request && message.sessionId) {
          const session = await worker.start(
            message.request,
            message.sessionId,
          );
          writeMessage({
            type: "response",
            requestId: message.requestId,
            ok: true,
            session,
          });
          return;
        }
        if (message.type === "stop") {
          if (message.sessionId)
            await worker.stop(message.sessionId, Boolean(message.discardCache));
          else await worker.stopAll(Boolean(message.discardCache));
          writeMessage({
            type: "response",
            requestId: message.requestId,
            ok: true,
          });
          return;
        }
        if (message.type === "stop_all") {
          await worker.stopAll(Boolean(message.discardCache));
          writeMessage({
            type: "response",
            requestId: message.requestId,
            ok: true,
          });
          return;
        }
        if (message.type === "ping") {
          writeMessage({
            type: "response",
            requestId: message.requestId,
            ok: true,
          });
          return;
        }
        throw new Error(`unknown torrent worker message: ${message.type}`);
      } catch (error) {
        writeMessage({
          type: "response",
          requestId: message.requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });
  const shutdown = () => void worker.dispose().finally(() => process.exit(0));
  input.once("close", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (!process.env.VITEST) {
  void main().catch((error) => {
    process.stderr.write(`[torrent-node] fatal: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
