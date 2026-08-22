import { TFunction } from "i18next";

const GENERIC_SEASON_TITLE_PATTERN = /^season\s+\d+$/i;
const GENERIC_SPECIALS_TITLE_PATTERN = /^specials?$/i;

export function formatSeasonTitle(
  title: string | undefined,
  seasonNumber: number | undefined,
  t: TFunction,
  specialsLabel: "episode" | "season" = "episode",
) {
  const trimmedTitle = title?.trim();

  if (
    seasonNumber === 0 ||
    (trimmedTitle && GENERIC_SPECIALS_TITLE_PATTERN.test(trimmedTitle))
  ) {
    return specialsLabel === "season"
      ? t("details.specialSeason")
      : t("player.menus.episodes.specials");
  }

  if (
    seasonNumber !== undefined &&
    (!trimmedTitle || GENERIC_SEASON_TITLE_PATTERN.test(trimmedTitle))
  ) {
    return `${t("details.season")} ${seasonNumber}`;
  }

  return trimmedTitle || t("player.menus.episodes.loadingTitle");
}

export function hasGenericEpisodeTitle(
  episodeTitle: string | null | undefined,
  episodeNumber?: number,
): boolean {
  if (!episodeTitle) return true;

  const normalizedTitle = episodeTitle.trim().toLowerCase();
  if (!normalizedTitle) return true;
  if (episodeNumber !== undefined) {
    return (
      normalizedTitle === `episode ${episodeNumber}` ||
      normalizedTitle === `ep ${episodeNumber}` ||
      normalizedTitle === `ep. ${episodeNumber}` ||
      normalizedTitle === `episode` ||
      normalizedTitle === `ep` ||
      new RegExp(`^(ep(isode)?\\.?|t[ậa]p)\\s*0*${episodeNumber}$`, "i").test(
        normalizedTitle,
      )
    );
  }

  return /^(ep(isode)?\.?|t[ậa]p)\s*\d+$/i.test(normalizedTitle);
}

export function formatEpisodeTitle(
  title: string | null | undefined,
  episodeNumber: number | undefined,
  t: TFunction,
): string {
  if (
    episodeNumber !== undefined &&
    hasGenericEpisodeTitle(title, episodeNumber)
  ) {
    return t("details.episodeNumber", {
      number: episodeNumber,
    });
  }

  return (
    title?.trim() ||
    (episodeNumber !== undefined
      ? t("details.episodeNumber", { number: episodeNumber })
      : "")
  );
}
