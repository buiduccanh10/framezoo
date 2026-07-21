import { describe, expect, it } from "vitest";

import { formatListMediaItem } from "@/backend/accounts/lists";

describe("formatListMediaItem", () => {
  it("maps movie details to a media item", () => {
    const result = formatListMediaItem(
      {
        id: 99,
        title: "Arrival",
        release_date: "2016-11-11",
        poster_path: "/poster.jpg",
      } as any,
      "movie",
    );

    expect(result).toMatchObject({
      id: "99",
      title: "Arrival",
      year: 2016,
      type: "movie",
      poster: expect.stringContaining("/poster.jpg"),
    });
  });

  it("maps tv details to a media item", () => {
    const result = formatListMediaItem(
      {
        id: 77,
        name: "Dark",
        first_air_date: "2017-12-01",
        poster_path: "/poster.jpg",
      } as any,
      "tv",
    );

    expect(result).toMatchObject({
      id: "77",
      title: "Dark",
      year: 2017,
      type: "show",
      poster: expect.stringContaining("/poster.jpg"),
    });
  });
});
