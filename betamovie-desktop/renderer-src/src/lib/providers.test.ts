import { describe, expect, it, vi } from "vitest";

import { NotFoundError, type Stream, buildProviders } from "./providers";

const media = {
  type: "movie" as const,
  tmdbId: "1",
  title: "Test movie",
};

function stream(): Stream {
  return {
    type: "hls",
    playlist: "https://stream.test/master.m3u8",
    captions: [],
  };
}

describe("provider runner", () => {
  it("continues after a timed out server and accepts a later playable server", async () => {
    vi.useFakeTimers();

    const never = new Promise<never>(() => {});
    const provider = buildProviders()
      .addSource({
        id: "rank-1",
        name: "Rank 1",
        rank: 1,
        scrapeMovie: async () => never,
      })
      .addSource({
        id: "rank-2",
        name: "Rank 2",
        rank: 2,
        scrapeMovie: async () => ({
          embeds: [
            { embedId: "server", url: "slow-server" },
            { embedId: "server", url: "working-server" },
          ],
        }),
      })
      .addEmbed({
        id: "server",
        name: "Server",
        scrape: async ({ url }) => {
          if (url === "slow-server") return never;
          if (url === "working-server") return { stream: [stream()] };
          throw new NotFoundError("Unknown server");
        },
      })
      .build();

    const resultPromise = provider.runAll({
      media,
      events: {},
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(resultPromise).resolves.toMatchObject({
      sourceId: "rank-2",
      embedId: "server",
    });

    vi.useRealTimers();
  });

  it("warms every remaining source in the background", async () => {
    const scraped: string[] = [];
    const provider = buildProviders()
      .addSource({
        id: "rank-1",
        name: "Rank 1",
        rank: 1,
        scrapeMovie: async () => ({ stream: [stream()], embeds: [] }),
      })
      .addSource({
        id: "rank-2",
        name: "Rank 2",
        rank: 2,
        scrapeMovie: async () => {
          scraped.push("rank-2");
          return { stream: [stream()], embeds: [] };
        },
      })
      .addSource({
        id: "rank-3",
        name: "Rank 3",
        rank: 3,
        scrapeMovie: async () => {
          scraped.push("rank-3");
          return { stream: [stream()], embeds: [] };
        },
      })
      .build();

    await provider.warmSources({
      media,
      sourceIds: ["rank-2", "rank-3"],
    });

    expect(scraped).toEqual(expect.arrayContaining(["rank-2", "rank-3"]));
  });
});
