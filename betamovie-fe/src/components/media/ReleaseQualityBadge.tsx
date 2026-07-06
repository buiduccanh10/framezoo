import classNames from "classnames";

import type { TMDBMovieData } from "@/backend/metadata/types/tmdb";
import type { TraktReleaseResponse } from "@/backend/metadata/types/trakt";

export type ReleaseQualityVariant = "CAM" | "HD";

const HD_QUALITY_PATTERN =
  /(?:2160|1080|720|4k|uhd|bluray|brrip|bdrip|web[ .-]?dl|webrip|hdrip|hdtv|dvdrip|remux)/i;
const CAM_QUALITY_PATTERN =
  /(?:^|[^a-z])(cam|hdcam|hdts|telesync|telecine|ts|tc|screener)(?:$|[^a-z])/i;
const THEATRICAL_RELEASE_TYPES = new Set([2, 3]);
const DIGITAL_RELEASE_TYPES = new Set([4, 5]);

function getReleaseVariantFromDates(
  theatricalReleaseDate?: string,
  digitalReleaseDate?: string,
): ReleaseQualityVariant | null {
  const now = new Date();

  if (digitalReleaseDate) {
    if (now >= new Date(digitalReleaseDate)) {
      return "HD";
    }
  }

  if (theatricalReleaseDate) {
    if (now >= new Date(theatricalReleaseDate)) {
      return "CAM";
    }
  }

  return null;
}

function getTmdbReleaseDateByTypes(
  releaseDates: TMDBMovieData["release_dates"],
  types: Set<number>,
) {
  const preferredRegion =
    releaseDates?.results?.find((region) => region.iso_3166_1 === "US") ||
    releaseDates?.results?.find((region) => region.iso_3166_1 === "GB") ||
    releaseDates?.results?.[0];

  if (!preferredRegion?.release_dates?.length) return undefined;

  const matchingDates = preferredRegion.release_dates
    .filter(
      (entry) =>
        entry.release_date &&
        typeof entry.type === "number" &&
        types.has(entry.type),
    )
    .map((entry) => entry.release_date)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  return matchingDates[0];
}

export function getReleaseQualityVariant(
  releaseInfo: TraktReleaseResponse | null | undefined,
): ReleaseQualityVariant | null {
  if (!releaseInfo) return null;

  const normalizedQuality = releaseInfo.quality?.trim();
  if (normalizedQuality) {
    if (CAM_QUALITY_PATTERN.test(normalizedQuality)) {
      return "CAM";
    }

    if (HD_QUALITY_PATTERN.test(normalizedQuality)) {
      return "HD";
    }
  }

  return getReleaseVariantFromDates(
    releaseInfo.theatrical_release_date,
    releaseInfo.digital_release_date,
  );
}

export function getReleaseQualityVariantFromTmdbReleaseDates(
  releaseDates: TMDBMovieData["release_dates"] | null | undefined,
): ReleaseQualityVariant | null {
  if (!releaseDates) return null;

  const theatricalReleaseDate = getTmdbReleaseDateByTypes(
    releaseDates,
    THEATRICAL_RELEASE_TYPES,
  );
  const digitalReleaseDate = getTmdbReleaseDateByTypes(
    releaseDates,
    DIGITAL_RELEASE_TYPES,
  );

  return getReleaseVariantFromDates(theatricalReleaseDate, digitalReleaseDate);
}

export function ReleaseQualityBadge({
  variant,
  className,
}: {
  variant: ReleaseQualityVariant;
  className?: string;
}) {
  return (
    <div
      className={classNames(
        "rounded-lg bg-gray-600/40 px-2 py-1 backdrop-blur-sm",
        className,
      )}
    >
      <span
        className={classNames("text-xs font-semibold", {
          "text-yellow-400": variant === "CAM",
          "text-green-400": variant === "HD",
        })}
      >
        {variant}
      </span>
    </div>
  );
}
