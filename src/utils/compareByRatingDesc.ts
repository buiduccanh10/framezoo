export interface RatedMediaItem {
  vote_average?: number;
  vote_count?: number;
}

function getWeightedScore(item: RatedMediaItem) {
  const votes = item.vote_count ?? 0;
  const rating = item.vote_average ?? 0;

  if (votes <= 0 || rating <= 0) return 0;

  // Favor titles with more established audience consensus while keeping the
  // TMDB rating itself as the primary signal.
  return rating * Math.sqrt(Math.log10(votes + 1));
}

export function compareByRatingDesc(a: RatedMediaItem, b: RatedMediaItem) {
  const weightedDiff = getWeightedScore(b) - getWeightedScore(a);
  if (weightedDiff !== 0) return weightedDiff;

  const voteDiff = (b.vote_count ?? 0) - (a.vote_count ?? 0);
  if (voteDiff !== 0) return voteDiff;

  return (b.vote_average ?? 0) - (a.vote_average ?? 0);
}
