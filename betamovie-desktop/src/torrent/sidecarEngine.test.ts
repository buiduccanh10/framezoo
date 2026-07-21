import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { TorrentStatus } from "../types";
import { SidecarTorrentEngine } from "./sidecarEngine";

function waitFor<T>(read: () => T | undefined, timeoutMs = 2_000) {
  return new Promise<T>((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const value = read();
      if (value !== undefined) {
        clearInterval(timer);
        resolve(value);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error("timed out waiting for sidecar status"));
      }
    }, 10);
  });
}

describe("sidecar torrent engine", () => {
  it("marks active streams unavailable when the sidecar exits", async () => {
    const directory = await mkdtemp(join(tmpdir(), "betamovie-sidecar-"));
    const executablePath = join(directory, "fake-sidecar.js");
    await writeFile(
      executablePath,
      `#!/usr/bin/env node
const readline = require("node:readline");
const input = readline.createInterface({ input: process.stdin });

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type !== "start") return;

  process.stdout.write(JSON.stringify({
    type: "response",
    requestId: message.requestId,
    ok: true,
    session: {
      sessionId: message.sessionId,
      sourceId: message.request.sourceId,
      streamUrl: "http://127.0.0.1:12345/torrent/" + message.sessionId,
    },
  }) + "\\n");

  process.stdout.write(JSON.stringify({
    type: "status",
    status: {
      sessionId: message.sessionId,
      sourceId: message.request.sourceId,
      state: "downloading",
      progress: 13.9,
      speedBytesPerSecond: 1024,
      peers: 2,
      infoHash: null,
      fileName: "fixture.mkv",
      downloadedBytes: 139,
      totalBytes: 1000,
      streamUrl: "http://127.0.0.1:12345/torrent/" + message.sessionId,
      error: null,
      updatedAt: Date.now(),
    },
  }) + "\\n");

  setTimeout(() => process.exit(23), 20);
});
`,
    );
    await chmod(executablePath, 0o755);

    const engine = new SidecarTorrentEngine(executablePath);
    const statuses: TorrentStatus[] = [];

    try {
      const session = await engine.start(
        {
          sourceId: "fixture-source",
          url: "magnet:?xt=urn:btih:fixture",
        },
        (status) => statuses.push(status),
      );

      const errorStatus = await waitFor(() =>
        statuses.find((status) => status.state === "error"),
      );

      expect(errorStatus.sessionId).toBe(session.sessionId);
      expect(errorStatus.streamUrl).toBeNull();
      expect(errorStatus.error).toContain("no longer available");
      expect(engine.getStatus(session.sessionId)?.state).toBe("error");
    } finally {
      await engine.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
