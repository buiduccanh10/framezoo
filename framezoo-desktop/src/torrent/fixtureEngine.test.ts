import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { TorrentStatus } from "../types";
import { FixtureTorrentEngine } from "./fixtureEngine";

describe("fixture torrent engine", () => {
  it("starts, serves ranges, reports progress, and stops", async () => {
    const directory = await mkdtemp(join(tmpdir(), "framezoo-torrent-"));
    const fixturePath = join(directory, "fixture.mp4");
    await writeFile(fixturePath, Buffer.from("fixture torrent bytes"));

    const engine = new FixtureTorrentEngine({
      filePath: fixturePath,
      intervalMs: 5,
    });
    const statuses: TorrentStatus[] = [];

    try {
      const session = await engine.start(
        {
          sourceId: "fixture-source",
          url: "magnet:?xt=urn:btih:fixture",
        },
        (status) => statuses.push(status),
      );

      const response = await fetch(session.streamUrl, {
        headers: { Range: "bytes=0-6" },
      });
      expect(response.status).toBe(206);
      expect(await response.text()).toBe("fixture");

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(statuses.some((status) => status.state === "ready")).toBe(true);

      await engine.stop(session.sessionId);
      expect(statuses.at(-1)?.state).toBe("stopped");
    } finally {
      await engine.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
