import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AppPreviewShowcase,
  normalizePreviewTmdbItems,
} from "./AppPreviewShowcase";

describe("AppPreviewShowcase", () => {
  it("normalizes TMDB movie and tv items with metadata fields", () => {
    expect(
      normalizePreviewTmdbItems({
        results: [
          { id: 1, title: "No Poster", poster_path: null },
          {
            id: 42,
            media_type: "movie",
            title: "Sample Film",
            overview: "A sample synopsis.",
            poster_path: "/poster.jpg",
            backdrop_path: "/backdrop.jpg",
            vote_average: 8.34,
            release_date: "2026-04-01",
          },
          {
            id: 99,
            name: "Sample Series",
            poster_path: "/tv.jpg",
            first_air_date: "2025-10-12",
          },
        ],
      }),
    ).toEqual([
      {
        id: 42,
        mediaType: "movie",
        title: "Sample Film",
        overview: "A sample synopsis.",
        posterPath: "/poster.jpg",
        backdropPath: "/backdrop.jpg",
        voteAverage: 8.3,
        year: "2026",
      },
      {
        id: 99,
        mediaType: "tv",
        title: "Sample Series",
        overview:
          "Explore rich title metadata, ratings, and synchronized subtitles from official APIs.",
        posterPath: "/tv.jpg",
        backdropPath: null,
        voteAverage: null,
        year: "2025",
      },
    ]);
  });

  it("renders neutral simulated preview frames in SSR", () => {
    const detailHtml = renderToStaticMarkup(
      createElement(AppPreviewShowcase, {
        variant: "detail",
        ariaLabel: "Detail preview",
      }),
    );
    const discoveryHtml = renderToStaticMarkup(
      createElement(AppPreviewShowcase, {
        variant: "discovery",
        ariaLabel: "Discovery preview",
      }),
    );

    expect(detailHtml).toContain("Dual Subtitles: EN + VI");
    expect(detailHtml).toContain("Modular Metadata View");
    expect(discoveryHtml).toContain("Search TMDB titles...");
    expect(discoveryHtml).toContain("Addon Catalog Browser");
  });
});
