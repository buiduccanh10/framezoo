import classNames from "classnames";

import type { TMDBMovieData } from "@/backend/metadata/types/tmdb";
import type { TraktReleaseResponse } from "@/backend/metadata/types/trakt";

export type ReleaseQualityVariant = "CAM" | "HD";

type TMDBMovieReleaseDates = NonNullable<TMDBMovieData["release_dates"]>;
type TMDBMovieReleaseRegion = TMDBMovieReleaseDates["results"][number];
type TMDBMovieReleaseEntry = TMDBMovieReleaseRegion["release_dates"][number];

const HD_QUALITY_PATTERN =
  /(?:2160|1080|720|4k|uhd|bluray|brrip|bdrip|web[ .-]?dl|webrip|hdrip|hdtv|dvdrip|remux)/i;
const CAM_QUALITY_PATTERN =
  /(?:^|[^a-z])(cam|hdcam|hdts|telesync|telecine|ts|tc|screener)(?:$|[^a-z])/i;
const THEATRICAL_RELEASE_TYPES = new Set([2, 3]);
const DIGITAL_RELEASE_TYPES = new Set([4, 5]);

export function getReleaseQualityVariantFromLabel(
  quality?: string | null,
): ReleaseQualityVariant | null {
  const normalizedQuality = quality?.trim();
  if (!normalizedQuality) return null;

  if (CAM_QUALITY_PATTERN.test(normalizedQuality)) {
    return "CAM";
  }

  if (HD_QUALITY_PATTERN.test(normalizedQuality)) {
    return "HD";
  }

  return null;
}

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

function getMatchingReleaseDates(
  regions: TMDBMovieReleaseRegion[] | undefined,
  types: Set<number>,
): string[] {
  if (!regions?.length) return [];

  return regions
    .flatMap((region: TMDBMovieReleaseRegion) => region.release_dates)
    .filter(
      (entry: TMDBMovieReleaseEntry) =>
        entry.release_date &&
        typeof entry.type === "number" &&
        types.has(entry.type),
    )
    .map((entry: TMDBMovieReleaseEntry) => entry.release_date)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
}

function getTmdbReleaseDateByTypes(
  releaseDates: TMDBMovieData["release_dates"],
  types: Set<number>,
) {
  const preferredRegions = releaseDates?.results?.filter(
    (region) => region.iso_3166_1 === "US" || region.iso_3166_1 === "GB",
  );
  const preferredMatchingDates = getMatchingReleaseDates(
    preferredRegions,
    types,
  );

  if (preferredMatchingDates.length > 0) {
    return preferredMatchingDates[0];
  }

  return getMatchingReleaseDates(releaseDates?.results, types)[0];
}

export function getReleaseQualityVariant(
  releaseInfo: TraktReleaseResponse | null | undefined,
): ReleaseQualityVariant | null {
  if (!releaseInfo) return null;

  const dateBasedVariant = getReleaseVariantFromDates(
    releaseInfo.theatrical_release_date,
    releaseInfo.digital_release_date,
  );
  if (dateBasedVariant === "HD") {
    return "HD";
  }

  return (
    getReleaseQualityVariantFromLabel(releaseInfo.quality) ?? dateBasedVariant
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
  compact = false,
}: {
  variant: ReleaseQualityVariant;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={classNames(
        compact
          ? "inline-flex items-center justify-center rounded-md bg-gray-600/40 px-2 py-2 backdrop-blur-sm"
          : "inline-flex items-center justify-center rounded-lg bg-gray-600/40 px-2 py-1 backdrop-blur-sm",
        className,
      )}
    >
      <span
        className={classNames(
          compact
            ? "block whitespace-nowrap text-center text-[10px] font-semibold leading-none"
            : "block text-center text-xs font-semibold leading-none",
          {
            "text-yellow-400": variant === "CAM",
            "text-green-400": variant === "HD",
          },
        )}
      >
        {variant === "CAM" ? "In Cinema" : variant}
      </span>
    </div>
  );
}
