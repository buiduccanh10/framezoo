export interface SearchRankableItem {
  titleVariants: string[];
  bestSourceRank: number;
  hasPrimaryLanguageResult: boolean;
  vote_average?: number;
  vote_count?: number;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getQueryTokens(value: string): string[] {
  const normalized = normalizeSearchText(value);
  return normalized === "" ? [] : normalized.split(" ");
}

export function scoreSearchTitleMatch(
  query: string,
  titleVariants: string[],
): number {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery === "") return 0;

  const queryTokens = getQueryTokens(normalizedQuery);
  let bestScore = 0;

  for (const titleVariant of titleVariants) {
    const normalizedTitle = normalizeSearchText(titleVariant);
    if (normalizedTitle === "") continue;

    if (normalizedTitle === normalizedQuery) {
      return 500;
    }

    if (normalizedTitle.startsWith(normalizedQuery)) {
      bestScore = Math.max(bestScore, 400);
      continue;
    }

    if (normalizedTitle.includes(` ${normalizedQuery} `)) {
      bestScore = Math.max(bestScore, 320);
      continue;
    }

    if (normalizedTitle.endsWith(` ${normalizedQuery}`)) {
      bestScore = Math.max(bestScore, 320);
      continue;
    }

    if (normalizedTitle.includes(normalizedQuery)) {
      bestScore = Math.max(bestScore, 260);
      continue;
    }

    const titleTokens = normalizedTitle.split(" ");
    const containsAllTokens = queryTokens.every((token) =>
      titleTokens.includes(token),
    );
    if (containsAllTokens) {
      bestScore = Math.max(bestScore, 200);
      continue;
    }

    const sharedTokenCount = queryTokens.filter((token) =>
      titleTokens.includes(token),
    ).length;
    if (sharedTokenCount > 0) {
      bestScore = Math.max(
        bestScore,
        100 + Math.min(sharedTokenCount, queryTokens.length) * 20,
      );
    }
  }

  return bestScore;
}

export function compareSearchRankables(
  query: string,
  a: SearchRankableItem,
  b: SearchRankableItem,
): number {
  const aTitleScore = scoreSearchTitleMatch(query, a.titleVariants);
  const bTitleScore = scoreSearchTitleMatch(query, b.titleVariants);
  if (aTitleScore !== bTitleScore) return bTitleScore - aTitleScore;

  const primaryLanguageDiff =
    Number(b.hasPrimaryLanguageResult) - Number(a.hasPrimaryLanguageResult);
  if (primaryLanguageDiff !== 0) return primaryLanguageDiff;

  if (a.bestSourceRank !== b.bestSourceRank) {
    return a.bestSourceRank - b.bestSourceRank;
  }

  const voteDiff = (b.vote_count ?? 0) - (a.vote_count ?? 0);
  if (voteDiff !== 0) return voteDiff;

  return (b.vote_average ?? 0) - (a.vote_average ?? 0);
}
