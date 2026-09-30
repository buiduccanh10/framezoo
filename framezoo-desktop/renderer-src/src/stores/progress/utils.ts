import {
  ProgressEpisodeItem,
  ProgressItem,
  ProgressMediaItem,
  ProgressSeasonItem,
} from "@/stores/progress";
import type { WatchHistoryItem } from "@/stores/watchHistory";

export interface ShowProgressResult {
  episode?: ProgressEpisodeItem;
  season?: ProgressSeasonItem;
  progress: ProgressItem;
  show: boolean;
}

const defaultProgress = {
  duration: 0,
  watched: 0,
};

export function mergeCompletedHistoryIntoProgress(
  progress: ProgressMediaItem | undefined,
  history: WatchHistoryItem[],
): ProgressMediaItem | undefined {
  const completedEpisodes = history.filter(
    (item) =>
      item.completed &&
      item.episodeId &&
      item.seasonId &&
      item.episodeNumber !== undefined &&
      item.seasonNumber !== undefined,
  );
  if (completedEpisodes.length === 0) return progress;

  const firstEpisode = completedEpisodes[0];
  const merged: ProgressMediaItem = {
    ...(progress ?? {
      type: "show",
      title: firstEpisode.title,
      year: firstEpisode.year,
      poster: firstEpisode.poster,
      updatedAt: 0,
      episodes: {},
      seasons: {},
    }),
    episodes: { ...(progress?.episodes ?? {}) },
    seasons: { ...(progress?.seasons ?? {}) },
  };

  completedEpisodes.forEach((item) => {
    if (merged.episodes[item.episodeId!]) return;

    merged.seasons[item.seasonId!] ??= {
      id: item.seasonId!,
      number: item.seasonNumber!,
      title: "",
    };
    merged.episodes[item.episodeId!] = {
      id: item.episodeId!,
      number: item.episodeNumber!,
      title: "",
      seasonId: item.seasonId!,
      updatedAt: item.watchedAt,
      progress: item.progress,
    };
    merged.updatedAt = Math.max(merged.updatedAt, item.watchedAt);
  });

  return merged;
}

function progressIsCompleted(duration: number, watched: number): boolean {
  const timeFromEnd = duration - watched;

  // too close to the end, is completed
  if (timeFromEnd < 60 * 2) return true;

  // satisfies all constraints, not completed
  return false;
}

function progressIsNotStarted(duration: number, watched: number): boolean {
  // too short watch time
  if (watched < 20) return true;

  // satisfies all constraints, not completed
  return false;
}

function progressIsAcceptableRange(duration: number, watched: number): boolean {
  // not started enough yet, not acceptable
  if (progressIsNotStarted(duration, watched)) return false;

  // is already at the end, not acceptable
  if (progressIsCompleted(duration, watched)) return false;

  // satisfied all constraints
  return true;
}

function isFirstEpisodeOfShow(
  item: ProgressMediaItem,
  episode: ProgressEpisodeItem,
): boolean {
  const seasonId = episode.seasonId;
  const season = item.seasons[seasonId];
  return season.number === 1 && episode.number === 1;
}

export function getProgressPercentage(
  watched: number,
  duration: number,
): number {
  // Handle edge cases to prevent infinity or invalid percentages
  if (!duration || duration <= 0) return 0;
  if (!watched || watched < 0) return 0;

  // Cap percentage at 100% to prevent >100% values
  const percentage = Math.min((watched / duration) * 100, 100);
  return percentage;
}

export function shouldShowProgress(
  item: ProgressMediaItem,
): ShowProgressResult {
  // non shows just hide or show depending on acceptable ranges
  if (item.type !== "show") {
    return {
      show: progressIsAcceptableRange(
        item.progress?.duration ?? 0,
        item.progress?.watched ?? 0,
      ),
      progress: item.progress ?? defaultProgress,
    };
  }

  // shows only hide an item if its too early in episode, it still shows if its near the end.
  // Otherwise you would lose episode progress
  const ep = Object.values(item.episodes)
    .sort((a, b) => {
      if (b.updatedAt !== a.updatedAt) {
        return b.updatedAt - a.updatedAt;
      }
      const seasonA = item.seasons[a.seasonId]?.number ?? 0;
      const seasonB = item.seasons[b.seasonId]?.number ?? 0;
      if (seasonB !== seasonA) {
        return seasonB - seasonA;
      }
      return b.number - a.number;
    })
    .filter(
      (epi) =>
        !progressIsNotStarted(epi.progress.duration, epi.progress.watched) ||
        !isFirstEpisodeOfShow(item, epi),
    )[0];

  const season = item.seasons[ep?.seasonId];
  if (!ep || !season)
    return {
      show: false,
      progress: defaultProgress,
    };
  return {
    season,
    episode: ep,
    show: true,
    progress: ep.progress,
  };
}
