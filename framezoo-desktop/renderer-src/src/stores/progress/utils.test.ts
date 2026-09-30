import { describe, expect, it } from "vitest";

import type { WatchHistoryItem } from "@/stores/watchHistory";

import { mergeCompletedHistoryIntoProgress, shouldShowProgress } from "./utils";

function completedEpisode(
  seasonNumber: number,
  episodeNumber: number,
): WatchHistoryItem {
  return {
    type: "show",
    title: "Reacher",
    year: 2022,
    progress: { watched: 60, duration: 60 },
    watchedAt: 1_000,
    completed: true,
    seasonId: `season-${seasonNumber}`,
    episodeId: `episode-${seasonNumber}-${episodeNumber}`,
    seasonNumber,
    episodeNumber,
  };
}

describe("mergeCompletedHistoryIntoProgress", () => {
  it("restores the latest completed episode when progress was pruned", () => {
    const progress = mergeCompletedHistoryIntoProgress(undefined, [
      completedEpisode(1, 8),
      completedEpisode(3, 8),
    ]);

    expect(Object.keys(progress?.episodes ?? {})).toHaveLength(2);
    expect(
      Object.values(progress?.episodes ?? {}).filter(
        (episode) => episode.progress.watched / episode.progress.duration > 0.9,
      ),
    ).toHaveLength(2);
    expect(shouldShowProgress(progress!)).toMatchObject({
      season: { number: 3 },
      episode: { number: 8 },
    });
  });

  it("keeps an existing progress record over stale history", () => {
    const existing = completedEpisode(3, 8);
    const progress = mergeCompletedHistoryIntoProgress(
      {
        type: "show",
        title: "Reacher",
        updatedAt: 2_000,
        episodes: {
          [existing.episodeId!]: {
            id: existing.episodeId!,
            number: existing.episodeNumber!,
            title: "Episode 8",
            seasonId: existing.seasonId!,
            updatedAt: 2_000,
            progress: { watched: 0, duration: 60 },
          },
        },
        seasons: {
          [existing.seasonId!]: {
            id: existing.seasonId!,
            number: existing.seasonNumber!,
            title: "Season 3",
          },
        },
      },
      [existing],
    );

    expect(progress?.episodes[existing.episodeId!]?.progress).toEqual({
      watched: 0,
      duration: 60,
    });
  });
});
