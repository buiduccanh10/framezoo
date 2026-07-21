import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname } from "node:path";
import { randomUUID } from "node:crypto";

type RegisteredFile = {
  filePath: string;
  contentType: string;
};

const contentTypes: Record<string, string> = {
  ".m4v": "video/mp4",
  ".mkv": "video/x-matroska",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function getContentType(filePath: string) {
  return contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function writeCorsHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  response.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range");
  response.setHeader("Accept-Ranges", "bytes");
}

function getRange(request: IncomingMessage, size: number) {
  const value = request.headers.range;
  if (!value) return null;

  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match) return null;

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

export class TorrentRangeServer {
  private readonly files = new Map<string, RegisteredFile>();
  private server: ReturnType<typeof createServer> | null = null;
  private address = "";

  async start() {
    if (this.server) return this.address;

    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(0, "127.0.0.1", () => resolve());
    });

    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("torrent range server did not bind to a TCP port");
    }

    this.address = `http://127.0.0.1:${address.port}`;
    return this.address;
  }

  register(sessionId: string, filePath: string) {
    const id = encodeURIComponent(sessionId);
    this.files.set(id, {
      filePath,
      contentType: getContentType(filePath),
    });
    return `${this.address}/torrent/${id}`;
  }

  unregister(sessionId: string) {
    this.files.delete(encodeURIComponent(sessionId));
  }

  async close() {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;
    this.address = "";
    this.files.clear();
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method === "OPTIONS") {
      writeCorsHeaders(response);
      response.writeHead(204);
      response.end();
      return;
    }

    const match = /^\/torrent\/([^/]+)$/.exec(request.url ?? "");
    const file = match ? this.files.get(match[1]) : undefined;
    if (!file || (request.method !== "GET" && request.method !== "HEAD")) {
      response.writeHead(file ? 405 : 404);
      response.end();
      return;
    }

    try {
      const fileStats = await stat(file.filePath);
      const range = getRange(request, fileStats.size);
      const start = range?.start ?? 0;
      const end = range?.end ?? Math.max(0, fileStats.size - 1);
      const length = Math.max(0, end - start + 1);

      writeCorsHeaders(response);
      response.setHeader("Content-Type", file.contentType);
      response.setHeader("Content-Length", length);

      if (range) {
        response.statusCode = 206;
        response.setHeader("Content-Range", `bytes ${start}-${end}/${fileStats.size}`);
      } else {
        response.statusCode = 200;
      }

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      createReadStream(file.filePath, { start, end }).pipe(response);
    } catch {
      response.writeHead(404);
      response.end();
    }
  }
}

export function createTorrentSessionId() {
  return `torrent-${randomUUID()}`;
}
