import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerMeta } from "@/stores/player/slices/source";

const metadataMocks = vi.hoisted(() => ({
  getMetaFromId: vi.fn(),
}));

vi.mock("@/backend/metadata/getmeta", () => metadataMocks);

import {
  findNextEpisodeInSeason,
  getNextEpisodeAction,
  resolveNextEpisodeAction,
} from "./episodeNavigation";

function createMeta(episode: number, episodes: number[]): PlayerMeta {
  return {
    type: "show",
    title: "Test show",
    tmdbId: "show-1",
    releaseYear: 2020,
    season: {
      number: 3,
      tmdbId: "season-3",
      title: "Season 3",
    },
    episode: {
      number: episode,
      tmdbId: `episode-${episode}`,
      title: `Episode ${episode}`,
    },
    episodes: episodes.map((number) => ({
      number,
      tmdbId: `episode-${number}`,
      title: `Episode ${number}`,
    })),
  };
}

describe("episode navigation", () => {
  beforeEach(() => {
    metadataMocks.getMetaFromId.mockReset();
  });

  it("selects the next numbered episode instead of trusting array order", () => {
    const meta = createMeta(10, [1, 2, 10, 12, 11]);

    expect(getNextEpisodeAction(meta)).toMatchObject({
      episode: {
        number: 11,
      },
      isSeasonChange: false,
    });
  });

  it("finds the next episode without relying on array order", () => {
    expect(
      findNextEpisodeInSeason(
        [
          { number: 12, tmdbId: "12", title: "T12" },
          { number: 10, tmdbId: "10", title: "T10" },
          { number: 11, tmdbId: "11", title: "T11" },
        ],
        10,
      )?.number,
    ).toBe(11);
  });

  it("has no current-season action at the end of a season", () => {
    expect(getNextEpisodeAction(createMeta(12, [10, 11, 12]))).toBeNull();
  });

  it("re-reads the current season before falling back to the next season", async () => {
    metadataMocks.getMetaFromId.mockResolvedValueOnce({
      meta: {
        type: "series",
        seasonData: {
          episodes: [
            {
              id: "episode-11",
              number: 11,
              title: "Episode 11",
              air_date: "2020-01-01",
            },
          ],
        },
      },
    });

    const action = await resolveNextEpisodeAction(createMeta(10, [10]));

    expect(action).toMatchObject({
      episode: {
        number: 11,
        tmdbId: "episode-11",
      },
      isSeasonChange: false,
    });
    expect(metadataMocks.getMetaFromId).toHaveBeenCalledTimes(1);
  });
});
