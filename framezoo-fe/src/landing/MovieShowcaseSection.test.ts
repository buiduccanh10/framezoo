import { describe, expect, it } from "vitest";

import {
  TMDB_SHOWCASE_FEEDS,
  buildTmdbShowcaseColumns,
  normalizeTmdbResults,
  partitionMovieColumns,
} from "./MovieShowcaseSection";

describe("movie showcase poster data", () => {
  it("uses three distinct TMDB endpoints for the three columns", () => {
    expect(TMDB_SHOWCASE_FEEDS.map((feed) => feed.path)).toEqual([
      "/api/tmdb/trending/all/day",
      "/api/tmdb/movie/popular",
      "/api/tmdb/tv/popular",
    ]);
  });

  it("drops titles without a usable TMDB poster path", () => {
    expect(
      normalizeTmdbResults({
        results: [
          { id: 1, title: "Missing poster", poster_path: null },
          { id: 2, title: "Movie", poster_path: "/movie.jpg" },
          { id: 3, name: "Blank poster", poster_path: "  " },
        ],
      }),
    ).toEqual([
      {
        id: 2,
        mediaType: "movie",
        title: "Movie",
        posterPath: "/movie.jpg",
      },
    ]);
  });

  it("maps the three TMDB feeds to three columns without cross-column duplicates", () => {
    const trendingPayload = {
      results: [
        {
          id: 10,
          media_type: "movie",
          title: "Trending Movie",
          poster_path: "/t1.jpg",
        },
        {
          id: 20,
          media_type: "tv",
          name: "Trending Show",
          poster_path: "/t2.jpg",
        },
      ],
    };
    const popularMoviesPayload = {
      results: [
        { id: 10, title: "Trending Movie", poster_path: "/t1.jpg" },
        { id: 11, title: "Popular Movie", poster_path: "/m1.jpg" },
      ],
    };
    const popularTvPayload = {
      results: [
        { id: 20, name: "Trending Show", poster_path: "/t2.jpg" },
        { id: 21, name: "Popular Show", poster_path: "/tv1.jpg" },
      ],
    };

    expect(
      buildTmdbShowcaseColumns(
        [trendingPayload, popularMoviesPayload, popularTvPayload],
        2,
      ),
    ).toEqual([
      [
        {
          id: 10,
          mediaType: "movie",
          title: "Trending Movie",
          posterPath: "/t1.jpg",
        },
        {
          id: 20,
          mediaType: "tv",
          title: "Trending Show",
          posterPath: "/t2.jpg",
        },
      ],
      [
        {
          id: 11,
          mediaType: "movie",
          title: "Popular Movie",
          posterPath: "/m1.jpg",
        },
      ],
      [
        {
          id: 21,
          mediaType: "tv",
          title: "Popular Show",
          posterPath: "/tv1.jpg",
        },
      ],
    ]);
  });

  it("keeps the three mosaic columns on separate TMDB tracks when partitioning", () => {
    const movies = normalizeTmdbResults({
      results: Array.from({ length: 6 }, (_, index) => ({
        id: index + 1,
        title: `Movie ${index + 1}`,
        poster_path: `/movie-${index + 1}.jpg`,
      })),
    });

    expect(partitionMovieColumns(movies)).toEqual([
      [movies[0], movies[3]],
      [movies[1], movies[4]],
      [movies[2], movies[5]],
    ]);
  });
});
