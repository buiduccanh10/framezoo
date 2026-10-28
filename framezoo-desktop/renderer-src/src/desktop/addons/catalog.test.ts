import { describe, expect, it } from "vitest";

import { getCatalogMediaIdentity } from "./catalog";

describe("getCatalogMediaIdentity", () => {
  it("prefers a catalog TMDB id", () => {
    expect(
      getCatalogMediaIdentity({
        id: "kitsu:7442",
        tmdb_id: 1429,
        imdb_id: "tt2560140",
      }),
    ).toEqual({ kind: "tmdb", id: "1429" });
  });

  it("falls back to addon-provided IMDb ids", () => {
    expect(
      getCatalogMediaIdentity({
        id: "kitsu:7442",
        imdb_id: "tt2560140",
      }),
    ).toEqual({ kind: "imdb", id: "tt2560140" });
  });

  it("accepts native TMDB/IMDb ids and ignores unknown addon ids", () => {
    expect(getCatalogMediaIdentity({ id: "tmdb:1429" })).toEqual({
      kind: "tmdb",
      id: "1429",
    });
    expect(getCatalogMediaIdentity({ id: "tt2560140" })).toEqual({
      kind: "imdb",
      id: "tt2560140",
    });
    expect(getCatalogMediaIdentity({ id: "kitsu:7442" })).toBeNull();
  });
});
