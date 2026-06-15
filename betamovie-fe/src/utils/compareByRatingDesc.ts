export interface RatedMediaItem {
  vote_average?: number;
  vote_count?: number;
  release_date?: string | null;
  first_air_date?: string | null;
  last_air_date?: string | null;
  air_date?: string | null;
  original_release_date?: Date | string | null;
  media_type?: string;
  type?: string;
  last_episode_to_air?: {
    air_date?: string | null;
  } | null;
  seasons?: Array<{
    air_date?: string | null;
  }> | null;
}

export interface MediaQualityThreshold {
  minScore: number;
  minVotes: number;
  minYear?: number;
}

const CURRENT_YEAR = new Date().getFullYear();
export const DEFAULT_MEDIA_QUALITY_THRESHOLD: MediaQualityThreshold = {
  minScore: 5.5,
  minVotes: 200,
  minYear: CURRENT_YEAR - 12,
};

function extractYear(value?: string | Date | null): number | null {
  if (!value) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    return Number.isFinite(year) ? year : null;
  }

  const parsedYear = Number.parseInt(value.slice(0, 4), 10);
  return Number.isFinite(parsedYear) ? parsedYear : null;
}

export function getReferenceYear(item: RatedMediaItem): number | null {
  const seasonYears =
    item.seasons
      ?.map((season) => extractYear(season.air_date))
      .filter((year): year is number => year !== null) ?? [];

  const candidateYears = [
    extractYear(item.last_episode_to_air?.air_date),
    extractYear(item.last_air_date),
    seasonYears.length ? Math.max(...seasonYears) : null,
    extractYear(item.air_date),
    extractYear(item.release_date),
    extractYear(item.first_air_date),
    extractYear(item.original_release_date),
  ].filter((year): year is number => year !== null);

  if (candidateYears.length === 0) return null;
  return Math.max(...candidateYears);
}

export function meetsMediaQualityThreshold(
  item: RatedMediaItem,
  threshold: MediaQualityThreshold,
): boolean {
  const rating = item.vote_average ?? 0;
  const votes = item.vote_count ?? 0;
  if (rating < threshold.minScore || votes < threshold.minVotes) return false;

  if (typeof threshold.minYear === "number") {
    const referenceYear = getReferenceYear(item);
    if (!referenceYear || referenceYear < threshold.minYear) return false;
  }

  return true;
}

function getWeightedScore(item: RatedMediaItem) {
  const votes = item.vote_count ?? 0;
  const rating = item.vote_average ?? 0;
  const year = getReferenceYear(item) ?? CURRENT_YEAR - 30;

  if (votes <= 0 || rating <= 0) return 0;

  // Favor titles with more established audience consensus while keeping the
  // TMDB rating itself as the primary signal, then nudge newer releases up.
  const ratingConfidenceScore = rating * Math.sqrt(Math.log10(votes + 1));
  const recencyBoost = Math.max(0, year - (CURRENT_YEAR - 12)) * 0.03;
  return ratingConfidenceScore + recencyBoost;
}

function getRatingVoteWeightedScore(item: RatedMediaItem) {
  const votes = item.vote_count ?? 0;
  const rating = item.vote_average ?? 0;

  if (votes <= 0 || rating <= 0) return 0;
  return rating * Math.sqrt(Math.log10(votes + 1));
}

export function compareByRatingAndVoteDesc(
  a: RatedMediaItem,
  b: RatedMediaItem,
) {
  const weightedDiff =
    getRatingVoteWeightedScore(b) - getRatingVoteWeightedScore(a);
  if (weightedDiff !== 0) return weightedDiff;

  const voteDiff = (b.vote_count ?? 0) - (a.vote_count ?? 0);
  if (voteDiff !== 0) return voteDiff;

  return (b.vote_average ?? 0) - (a.vote_average ?? 0);
}

export function compareByRatingDesc(a: RatedMediaItem, b: RatedMediaItem) {
  const weightedDiff = getWeightedScore(b) - getWeightedScore(a);
  if (weightedDiff !== 0) return weightedDiff;

  const yearDiff = (getReferenceYear(b) ?? 0) - (getReferenceYear(a) ?? 0);
  if (yearDiff !== 0) return yearDiff;

  const voteDiff = (b.vote_count ?? 0) - (a.vote_count ?? 0);
  if (voteDiff !== 0) return voteDiff;

  return (b.vote_average ?? 0) - (a.vote_average ?? 0);
}

export function filterAndSortByQualityDesc<T extends RatedMediaItem>(
  items: T[],
  threshold: MediaQualityThreshold = DEFAULT_MEDIA_QUALITY_THRESHOLD,
): T[] {
  return [...items]
    .filter((item) => meetsMediaQualityThreshold(item, threshold))
    .sort(compareByRatingDesc);
}
