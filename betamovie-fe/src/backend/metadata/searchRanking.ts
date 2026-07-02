import {
  TMDBContentTypes,
  TMDBMovieSearchResult,
  TMDBShowSearchResult,
} from "./types/tmdb";

export type TMDBSearchMediaResult =
  | TMDBMovieSearchResult
  | TMDBShowSearchResult;

function getSearchResultKey(result: TMDBSearchMediaResult): string {
  return `${result.media_type}:${result.id}`;
}

function getSearchCandidateTitles(
  result: TMDBSearchMediaResult,
): Array<string | undefined> {
  if (result.media_type === TMDBContentTypes.TV) {
    return [result.name, result.original_name];
  }

  return [result.title, result.original_title];
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function getSearchScore(query: string, candidate: string): number {
  if (!query || !candidate) return 0;

  if (candidate === query) return 100;
  if (candidate.startsWith(`${query} `) || candidate.startsWith(query)) {
    return 80;
  }

  const candidateWords = candidate.split(" ");
  if (candidateWords.includes(query)) return 70;
  if (candidate.includes(query)) return 60;

  const queryWords = query.split(" ");
  const hasAllQueryWords = queryWords.every((word) =>
    candidateWords.some(
      (candidateWord) =>
        candidateWord === word || candidateWord.startsWith(word),
    ),
  );

  return hasAllQueryWords ? 40 : 0;
}

function rankSearchResults(
  query: string,
  results: TMDBSearchMediaResult[],
): TMDBSearchMediaResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return results;

  return results
    .map((result, index) => {
      const score = getSearchCandidateTitles(result)
        .map((title) => normalizeSearchText(title ?? ""))
        .reduce(
          (bestScore, title) =>
            Math.max(bestScore, getSearchScore(normalizedQuery, title)),
          0,
        );

      return {
        index,
        result,
        score,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map(({ result }) => result);
}

export function mergeAndRankSearchResults(
  query: string,
  ...resultGroups: TMDBSearchMediaResult[][]
): TMDBSearchMediaResult[] {
  const seen = new Set<string>();
  const mergedResults: TMDBSearchMediaResult[] = [];

  resultGroups.forEach((results) => {
    results.forEach((result) => {
      const key = getSearchResultKey(result);
      if (seen.has(key)) return;
      seen.add(key);
      mergedResults.push(result);
    });
  });

  return rankSearchResults(query, mergedResults);
}
