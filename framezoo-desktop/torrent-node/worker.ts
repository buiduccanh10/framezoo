import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
  TorrentSession,
  TorrentStartRequest,
  TorrentStatus,
} from "../src/types";
import { REQUEST_BLOCK_BYTES, VIRTUAL_PIECE_BYTES, VirtualCache } from "./virtualCache";

const MAX_CONNECTIONS = 35;
const PEER_SEARCH_MIN = 40;
const PEER_SEARCH_MAX = 150;
const TRACKER_PORT = 6881;
const DHT_LOOKUP_DELAY_MS = 0;
const REQUEST_TIMEOUT_MS = 4_000;
const PEER_WAIT_TIMEOUT_MS = 20_000;
const BLOCK_RACE_PEERS = 4;
const IDLE_RECORD_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.demonii.com:1337/announce",
  "http://tracker.qu.ax:6969/announce",
  "https://tracker.opentrackr.org:443/announce",
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
  session?: Partial<TorrentSession> & { streamUrl?: string; streamType?: string };
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
  for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) total += await directorySize(fullPath);
    else if (entry.isFile()) total += (await fs.stat(fullPath)).size;
  }
  return total;
}

async function enforceCacheLimit(root: string, maxBytes: number | null, active: Set<string>) {
  if (maxBytes === null) return;
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const candidates = [] as Array<{ path: string; size: number; mtime: number }>;
  let total = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^((?:torrent|framezoo-torrent|framezoo-node-torrent)-[a-z0-9_-]{1,128})$/i.test(entry.name)) continue;
    const entryPath = path.join(root, entry.name);
    const size = await directorySize(entryPath);
    total += size;
    if (!active.has(entryPath)) {
      candidates.push({ path: entryPath, size, mtime: (await fs.stat(entryPath)).mtimeMs });
    }
  }
  candidates.sort((a, b) => a.mtime - b.mtime);
  for (const candidate of candidates) {
    if (total <= maxBytes) break;
    await fs.rm(candidate.path, { recursive: true, force: true });
    total -= candidate.size;
  }
}

function writeMessage(message: WorkerResponse | { type: "status"; status: TorrentStatus }) {
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
  const prefix = ["qB4600", "DE2110", "AZ5770", "TR4040"][randomBytes(1)[0]! % 4]!
    .split("")
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
        const client = new TrackerClient(Buffer.from(peerId), TRACKER_PORT, {
          infoHash: this.infoHash,
          announce: [tracker],
        });
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
    this.dht.on("peer", (peer: { host: string; port: number }, hash: Buffer) => {
      if (hash.toString("hex") === this.infoHash) addPeer(`${peer.host}:${peer.port}`);
    });
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

function getContentType(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  return (
    {
      ".m4v": "video/mp4",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mkv": "video/x-matroska",
      ".avi": "video/x-msvideo",
      ".mov": "video/quicktime",
    } as Record<string, string>
  )[extension] ?? "application/octet-stream";
}

function parseRange(value: string | undefined, size: number) {
  if (!value) return { start: 0, end: Math.max(0, size - 1) };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2] || 0));
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
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
  response.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Accept, Origin");
  response.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range");
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
  private totalVerified = 0;
  private startedAt = Date.now();
  private readonly onChanged: () => void;
  private readonly cacheName: string;

  constructor(
    private readonly request: TorrentStartRequest,
    private readonly cacheRoot: string,
    onChanged: () => void,
  ) {
    this.infoHash = (request.infoHash ?? extractInfoHash(request.url))?.toLowerCase() ?? request.url;
    this.peerId = createPeerId();
    this.cacheName = this.infoHash.replace(/[^a-z0-9_-]/gi, "_");
    this.onChanged = onChanged;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    const root = path.join(cacheRoot, `framezoo-node-torrent-${this.cacheName}`);
    this.cachePath = root;
    const enginePath = path.join(root, "engine");
    this.engine = torrentStream(request.url, {
      path: enginePath,
      // Keep torrent-stream's metadata file inside the Node cache namespace.
      tmp: path.join(root, "metadata"),
      id: this.peerId,
      trackers: normalizeTrackers(request.trackers, request.url),
      connections: MAX_CONNECTIONS,
      timeout: REQUEST_TIMEOUT_MS,
      // Bootstrap magnet metadata before the post-ready bounded peer search.
      dht: true,
      tracker: true,
      uploads: 0,
      verify: false,
    });

    this.engine.on("ready", () => {
      void this.initializeMetadata();
    });
    this.engine.on("wire", (wire: TorrentWire) => {
      wire.interested?.();
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
        this.engine.listen(port, (error) => (error ? reject(error) : resolve()));
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
    const cachePath = path.join(this.cacheRoot, `framezoo-node-torrent-${this.cacheName}`);
    this.cache = new VirtualCache(cachePath, metadata, (stats) => {
      this.totalDownloaded = Math.max(this.totalDownloaded, stats.downloadedBytes);
      this.totalVerified = stats.verifiedBytes;
      this.onChanged();
    });
    try {
      await this.cache.open();
      this.readyResolve();
      this.onChanged();
    } catch (error) {
      this.readyError = error instanceof Error ? error : new Error(String(error));
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
    if (!total) return 0;
    return Math.min(100, (this.totalVerified / total) * 100);
  }

  async *readRange(file: TorrentFile, start: number, end: number, signal: AbortSignal) {
    if (!this.metadata || !this.cache) await this.ready();
    if (!this.metadata || !this.cache) throw new Error("torrent metadata unavailable");

    const absoluteStart = file.offset + start;
    const absoluteEnd = file.offset + end;
    let cursor = absoluteStart;
    while (cursor <= absoluteEnd) {
      if (signal.aborted) throw new Error("torrent range request aborted");
      const virtualIndex = Math.floor(cursor / this.cache.virtualPieceBytes);
      const virtualStart = this.cache.virtualStart(virtualIndex);
      const virtualEnd = virtualStart + this.cache.virtualLength(virtualIndex) - 1;
      const from = Math.max(cursor, virtualStart) - virtualStart;
      const to = Math.min(absoluteEnd, virtualEnd) - virtualStart + 1;
      await this.cache.ensureVirtualRange(
        virtualIndex,
        from,
        to - from,
        (blockOffset, blockLength) => {
          const absoluteBlock = virtualStart + blockOffset;
          const piece = Math.floor(absoluteBlock / this.metadata!.pieceLength);
          const pieceOffset = absoluteBlock - piece * this.metadata!.pieceLength;
          return this.requestBlock(piece, pieceOffset, blockLength, signal, blockOffset / REQUEST_BLOCK_BYTES);
        },
      );
      yield await this.cache.readRange(cursor, to - from);
      cursor = virtualStart + to;
    }
  }

  private async requestBlock(
    piece: number,
    offset: number,
    length: number,
    signal: AbortSignal,
    preferredWire = 0,
  ) {
    const deadline = Date.now() + PEER_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal.aborted) throw new Error("torrent range request aborted");
      const wires = this.engine.swarm.wires.filter(
        (wire) => !wire.peerChoking && getPeerPiece(wire, piece),
      );
      if (!wires.length) {
        await delay(150, undefined, { signal }).catch(() => {
          throw new Error("torrent range request aborted");
        });
        continue;
      }
      const ordered = [...wires.slice(preferredWire), ...wires.slice(0, preferredWire)];
      const candidates = ordered.slice(0, BLOCK_RACE_PEERS);
      const controllers = candidates.map(() => new AbortController());
      try {
        const winner = await Promise.any(
          candidates.map((wire, index) => {
            wire.interested?.();
            return this.requestFromWire(
              wire,
              piece,
              offset,
              length,
              AbortSignal.any([signal, controllers[index]!.signal]),
            );
          }),
        );
        return winner;
      } catch {
        // Rotate the candidate set after a failed race.
      } finally {
        for (const controller of controllers) controller.abort();
      }
    }
    throw new Error(`no peer delivered piece ${piece} block ${offset}`);
  }

  private requestFromWire(
    wire: TorrentWire,
    piece: number,
    offset: number,
    length: number,
    signal: AbortSignal,
  ) {
    return new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        wire.cancel?.(piece, offset, length);
        reject(new Error("torrent block request timed out"));
      }, REQUEST_TIMEOUT_MS);
      const abort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        wire.cancel?.(piece, offset, length);
        reject(new Error("torrent range request aborted"));
      };
      signal.addEventListener("abort", abort, { once: true });
      wire.request(piece, offset, length, (error, block) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (error || !block || block.length !== length) {
          reject(error ?? new Error("peer returned an invalid torrent block"));
          return;
        }
        resolve(block);
      });
    });
  }

  async destroy(discardCache: boolean) {
    this.cancelIdleDestroy();
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

  async startServer() {
    this.server = createServer((request, response) => {
      void this.handleHttp(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("torrent HTTP server failed to bind");
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async start(request: TorrentStartRequest, requestedSessionId?: string) {
    if (!request.url) throw new Error("torrent URL is required");
    const maxBytes = request.maxBytes ?? DEFAULT_MAX_BYTES;
    if (maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) {
      throw new Error("torrent cache size must be a non-negative integer or null");
    }
    const cacheRoot =
      (request.cacheRoot
        ? path.join(request.cacheRoot, "Framezoo", "torrents")
        : process.env.FRAMEZOO_TORRENT_DATA_DIR ||
          path.join(os.tmpdir(), "framezoo-torrents"));
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
    record.cancelIdleDestroy();
    const sessionId = requestedSessionId ?? `torrent-${randomBytes(12).toString("hex")}`;
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
    } satisfies Partial<TorrentSession> & { streamUrl: string; streamType: string };
  }

  async stop(sessionId: string, discardCache: boolean) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    session.state = "stopped";
    this.emitStatus(session);
    const hasOtherSession = [...this.sessions.values()].some((item) => item.record === session.record);
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
    await Promise.allSettled(records.map((record) => record.destroy(discardCache)));
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
    const match = /^\/torrent\/([^/]+)$/.exec((request.url ?? "").split("?", 1)[0]);
    const session = match ? this.sessions.get(decodeURIComponent(match[1])) : undefined;
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
        response.writeHead(416, { "Content-Range": `bytes */${session.file.length}` });
        response.end();
        return;
      }
      const length = range.end - range.start + 1;
      response.setHeader("Content-Type", getContentType(session.file.name ?? session.file.path ?? "video.mkv"));
      response.setHeader("Content-Length", length);
      response.setHeader("Cache-Control", "no-store");
      if (request.method === "HEAD") {
        response.writeHead(request.headers.range ? 206 : 200, request.headers.range ? {
          "Content-Range": `bytes ${range.start}-${range.end}/${session.file.length}`,
        } : undefined);
        response.end();
        return;
      }
      response.statusCode = request.headers.range ? 206 : 200;
      if (request.headers.range) response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${session.file.length}`);
      response.flushHeaders();
      for await (const chunk of session.record.readRange(session.file, range.start, range.end, abort.signal)) {
        if (abort.signal.aborted || response.destroyed) return;
        if (!session.firstByte) {
          session.firstByte = true;
          session.state = "ready";
          this.emitStatus(session);
        }
        response.write(chunk);
      }
      response.end();
    } catch (error) {
      if (!abort.signal.aborted && !response.headersSent) {
        session.state = "error";
        this.emitStatus(session, error instanceof Error ? error.message : String(error));
        response.writeHead(502);
        response.end();
      }
    }
  }

  private resolveFile(session: RuntimeSession, metadata: TorrentMetadata) {
    if (session.fileIdx !== null && metadata.files[session.fileIdx]) return metadata.files[session.fileIdx];
    const video = metadata.files
      .filter((file) => /\.(?:mkv|mp4|m4v|webm|avi|mov)$/i.test(file.name ?? file.path ?? ""))
      .sort((a, b) => b.length - a.length)[0];
    return video ?? [...metadata.files].sort((a, b) => b.length - a.length)[0] ?? null;
  }

  private status(session: RuntimeSession, error: string | null = null): TorrentStatus {
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
      streamType: session.state === "starting" || session.state === "buffering" ? "pending" : "file",
      streamUrl: session.state === "error" || session.state === "stopped" ? null : `${this.baseUrl}/torrent/${encodeURIComponent(session.sessionId)}`,
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
    for (const session of this.sessions.values()) this.emitStatus(session);
  }

  async dispose() {
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
          const session = await worker.start(message.request, message.sessionId);
          writeMessage({ type: "response", requestId: message.requestId, ok: true, session });
          return;
        }
        if (message.type === "stop") {
          if (message.sessionId) await worker.stop(message.sessionId, Boolean(message.discardCache));
          else await worker.stopAll(Boolean(message.discardCache));
          writeMessage({ type: "response", requestId: message.requestId, ok: true });
          return;
        }
        if (message.type === "stop_all") {
          await worker.stopAll(Boolean(message.discardCache));
          writeMessage({ type: "response", requestId: message.requestId, ok: true });
          return;
        }
        if (message.type === "ping") {
          writeMessage({ type: "response", requestId: message.requestId, ok: true });
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

void main().catch((error) => {
  process.stderr.write(`[torrent-node] fatal: ${String(error)}\n`);
  process.exitCode = 1;
});
