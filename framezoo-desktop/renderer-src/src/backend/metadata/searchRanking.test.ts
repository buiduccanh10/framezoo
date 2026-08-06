import { describe, expect, it } from "vitest";

import { mergeAndRankSearchResults } from "@/backend/metadata/searchRanking";
import {
  TMDBContentTypes,
  TMDBMovieSearchResult,
  TMDBShowSearchResult,
} from "@/backend/metadata/types/tmdb";

function createShowResult(
  overrides: Partial<TMDBShowSearchResult>,
): TMDBShowSearchResult {
  return {
    adult: false,
    backdrop_path: "",
    first_air_date: "2022-11-23",
    genre_ids: [],
    id: 1,
    media_type: TMDBContentTypes.TV,
    name: "Show",
    origin_country: ["US"],
    original_language: "en",
    original_name: "Show",
    overview: "",
    popularity: 10,
    poster_path: "",
    vote_average: 0,
    vote_count: 0,
    ...overrides,
  };
}

function createMovieResult(
  overrides: Partial<TMDBMovieSearchResult>,
): TMDBMovieSearchResult {
  return {
    adult: false,
    backdrop_path: "",
    genre_ids: [],
    id: 1,
    media_type: TMDBContentTypes.MOVIE,
    original_language: "en",
    original_title: "Movie",
    overview: "",
    popularity: 10,
    poster_path: "",
    release_date: "2024-01-01",
    title: "Movie",
    video: false,
    vote_average: 0,
    vote_count: 0,
    ...overrides,
  };
}

describe("mergeAndRankSearchResults", () => {
  it("dedupes fallback results but still ranks by original title", () => {
    const localizedWednesday = createShowResult({
      id: 100,
      name: "Chị Tư",
      original_name: "Wednesday",
    });
    const unrelatedNewerShow = createShowResult({
      id: 200,
      name: "New Mystery",
      original_name: "New Mystery",
      first_air_date: "2025-01-01",
    });
    const englishWednesday = createShowResult({
      id: 100,
      name: "Wednesday",
      original_name: "Wednesday",
    });

    const results = mergeAndRankSearchResults(
      "wednesday",
      [unrelatedNewerShow, localizedWednesday],
      [englishWednesday],
    );

    expect(results[0]?.id).toBe(100);
    expect(results.filter((result) => result.id === 100)).toHaveLength(1);
    expect((results[0] as TMDBShowSearchResult).name).toBe("Chị Tư");
  });

  it("keeps exact localized matches ahead of english fallback matches", () => {
    const localizedWednesday = createShowResult({
      id: 100,
      name: "Chị Tư",
      original_name: "Wednesday",
    });
    const englishAddamsMovie = createMovieResult({
      id: 300,
      title: "Wednesday Addams",
      original_title: "Wednesday Addams",
    });

    const results = mergeAndRankSearchResults(
      "chi tu",
      [localizedWednesday],
      [englishAddamsMovie],
    );

    expect(results[0]?.id).toBe(100);
  });
});
