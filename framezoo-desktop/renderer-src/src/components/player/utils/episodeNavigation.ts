import { getMetaFromId } from "@/backend/metadata/getmeta";
import { MWMediaType } from "@/backend/metadata/types/mw";
import { PlayerMeta, PlayerMetaEpisode } from "@/stores/player/slices/source";

import { hasAired } from "../utils/aired";

export interface NextEpisodeSeason {
  number: number;
  tmdbId: string;
  title: string;
}

export interface NextEpisodeAction {
  episode: PlayerMetaEpisode;
  season: NextEpisodeSeason | null;
  isSeasonChange: boolean;
}

export function findNextEpisodeInSeason(
  episodes: PlayerMetaEpisode[] | undefined,
  currentEpisodeNumber: number | undefined,
): PlayerMetaEpisode | null {
  if (currentEpisodeNumber == null) return null;

  return (
    [...(episodes ?? [])]
      .sort((a, b) => a.number - b.number)
      .find((episode) => episode.number === currentEpisodeNumber + 1) ?? null
  );
}

function toPlayerMetaEpisode(episode: {
  id: string;
  number: number;
  title: string;
  air_date?: string;
  overview?: string;
}): PlayerMetaEpisode {
  return {
    number: episode.number,
    title: episode.title,
    tmdbId: episode.id,
    air_date: episode.air_date,
    overview: episode.overview,
  };
}

export function getNextEpisodeAction(
  meta: PlayerMeta | null,
): NextEpisodeAction | null {
  if (meta?.type !== "show" || !meta.episode) return null;

  const nextEpisode = findNextEpisodeInSeason(
    meta.episodes,
    meta.episode.number,
  );
  if (!nextEpisode) return null;

  return {
    episode: nextEpisode,
    season: meta.season ?? null,
    isSeasonChange: false,
  };
}

export async function resolveNextEpisodeAction(
  meta: PlayerMeta | null,
): Promise<NextEpisodeAction | null> {
  const directAction = getNextEpisodeAction(meta);
  if (directAction) return directAction;
  if (meta?.type !== "show" || !meta.episode || !meta.tmdbId || !meta.season) {
    return null;
  }

  // Re-read the current season before falling through to the next season.
  // Player metadata can be a partial preload while the episode menu is complete.
  const currentSeasonData = await getMetaFromId(
    MWMediaType.SERIES,
    meta.tmdbId,
    meta.season.tmdbId,
  );
  if (currentSeasonData?.meta.type === MWMediaType.SERIES) {
    const currentSeasonEpisodes =
      currentSeasonData.meta.seasonData.episodes.map(toPlayerMetaEpisode);
    const nextEpisode = findNextEpisodeInSeason(
      currentSeasonEpisodes,
      meta.episode.number,
    );
    if (nextEpisode) {
      return {
        episode: nextEpisode,
        season: meta.season,
        isSeasonChange: false,
      };
    }
  }

  const showData = await getMetaFromId(MWMediaType.SERIES, meta.tmdbId);
  if (showData?.meta.type !== MWMediaType.SERIES) return null;

  const nextSeason = showData.meta.seasons.find(
    (season) => season.number === meta.season!.number + 1,
  );
  if (!nextSeason) return null;

  const nextSeasonData = await getMetaFromId(
    MWMediaType.SERIES,
    meta.tmdbId,
    nextSeason.id,
  );
  if (nextSeasonData?.meta.type !== MWMediaType.SERIES) return null;

  const nextEpisode = nextSeasonData.meta.seasonData.episodes
    .filter((episode) => hasAired(episode.air_date))
    .sort((a, b) => a.number - b.number)[0];
  if (!nextEpisode) return null;

  return {
    episode: toPlayerMetaEpisode(nextEpisode),
    season: {
      number: nextSeason.number,
      title: nextSeason.title,
      tmdbId: nextSeason.id,
    },
    isSeasonChange: true,
  };
}
