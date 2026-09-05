import { useCallback } from "react";

import { DetailedMeta } from "@/backend/metadata/getmeta";
import { MWMediaType } from "@/backend/metadata/types/mw";
import { usePlayer } from "@/components/player/hooks/usePlayer";
import { PlayerMeta, playerStatus } from "@/stores/player/slices/source";

export function usePlayerMeta() {
  const { meta, setMeta } = usePlayer();

  const setDirectMeta = useCallback(
    (m: PlayerMeta) => {
      setMeta(m, playerStatus.SOURCE_SELECTION);
    },
    [setMeta],
  );

  const setPlayerMeta = useCallback(
    (m: DetailedMeta, episodeId?: string) => {
      let playerMeta: PlayerMeta;
      if (m.meta.type === MWMediaType.SERIES) {
        const ep = m.meta.seasonData.episodes.find((v) => v.id === episodeId);
        if (!ep) return null;
        playerMeta = {
          type: "show",
          releaseYear: +(m.meta.year ?? 0),
          title: m.meta.title,
          poster: m.meta.poster,
          backdrop: m.meta.backdrop,
          logo: m.meta.logo,
          tmdbId: m.tmdbId ?? "",
          imdbId: m.imdbId,
          overview: m.meta.overview,
          originalLanguage: m.meta.originalLanguage,
          episodes: m.meta.seasonData.episodes.map((v) => ({
            number: v.number,
            title: v.title,
            tmdbId: v.id,
            air_date: v.air_date,
            overview: v.overview,
          })),
          episode: {
            number: ep.number,
            title: ep.title,
            tmdbId: ep.id,
            air_date: ep.air_date,
            overview: ep.overview,
          },
          season: {
            number: m.meta.seasonData.number,
            title: m.meta.seasonData.title,
            tmdbId: m.meta.seasonData.id,
          },
        };
      } else {
        playerMeta = {
          type: "movie",
          releaseYear: +(m.meta.year ?? 0),
          title: m.meta.title,
          poster: m.meta.poster,
          backdrop: m.meta.backdrop,
          logo: m.meta.logo,
          tmdbId: m.tmdbId ?? "",
          imdbId: m.imdbId,
          overview: m.meta.overview,
          originalLanguage: m.meta.originalLanguage,
        };
      }
      setDirectMeta(playerMeta);
      return playerMeta;
    },
    [setDirectMeta],
  );

  return {
    playerMeta: meta,
    setPlayerMeta,
    setDirectMeta,
  };
}
