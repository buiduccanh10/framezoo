import { beforeEach, describe, expect, it, vi } from "vitest";

const mwFetchMock = vi.fn();

vi.mock("@/backend/helpers/fetch", () => ({
  mwFetch: (...args: unknown[]) => mwFetchMock(...args),
}));

vi.mock("@/setup/config", () => ({
  conf: () => ({
    BACKEND_URL: "https://api.example.test",
    BACKEND_URLS: ["https://api.example.test"],
    PROXY_URLS: [],
    M3U8_PROXY_URLS: [],
    DISALLOWED_IDS: [],
    CDN_REPLACEMENTS: [],
    APP_DOMAIN: "https://example.test",
    APP_VERSION: "2.3.4",
    NORMAL_ROUTER: false,
    ALLOW_AUTOPLAY: false,
    SHOW_AD: false,
    AD_CONTENT_URL: [],
    TRACK_SCRIPT: null,
    BANNER_MESSAGE: null,
    BANNER_ID: null,
    USE_TRAKT: false,
    SHOW_SUPPORT_BAR: false,
    SUPPORT_BAR_VALUE: "",
    TIDB_API_KEY: null,
    CORS_PROXY_URL: "",
    M3U8_PROXY_URL: "",
  }),
}));

import { searchForMediaWithAi } from "@/backend/metadata/search";
import { TMDBContentTypes } from "@/backend/metadata/types/tmdb";

describe("searchForMediaWithAi", () => {
  beforeEach(() => {
    mwFetchMock.mockReset();
  });

  it("calls /api/ai/search, maps TMDB results to MediaItem[], and caches repeated queries", async () => {
    mwFetchMock.mockResolvedValueOnce({
      ok: true,
      intent: {
        intent: "hybrid",
        mediaType: "movie",
        summary: "Mind-bending sci-fi films",
        genres: ["science-fiction"],
        originCountries: ["US"],
        yearFrom: 2010,
        yearTo: null,
        candidateTitles: ["Inception"],
      },
      results: [
        {
          id: 27205,
          media_type: TMDBContentTypes.MOVIE,
          title: "Inception",
          poster_path: "/inception.jpg",
          release_date: "2010-07-16",
          genre_ids: [28, 878],
          origin_country: ["US"],
        },
      ],
    });

    const first = await searchForMediaWithAi({
      searchQuery: "Mind bending sci fi like Inception",
    });

    expect(mwFetchMock).toHaveBeenCalledTimes(1);
    expect(mwFetchMock).toHaveBeenCalledWith(
      "/api/ai/search",
      expect.objectContaining({
        baseURL: "https://api.example.test",
        method: "POST",
        body: expect.objectContaining({
          query: "Mind bending sci fi like Inception",
          mediaType: "all",
        }),
      }),
    );
    expect(first.intent.summary).toBe("Mind-bending sci-fi films");
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      id: "27205",
      title: "Inception",
      type: "movie",
      year: 2010,
      genreIds: [28, 878],
    });

    const second = await searchForMediaWithAi({
      searchQuery: "  mind bending sci fi like inception ",
    });
    expect(mwFetchMock).toHaveBeenCalledTimes(1);
    expect(second.items[0].id).toBe("27205");
  });
});
