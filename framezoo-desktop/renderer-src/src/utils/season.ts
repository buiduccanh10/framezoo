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
