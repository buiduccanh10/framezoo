import { describe, expect, it, vi } from "vitest";

import { MWMediaType } from "@/backend/metadata/types/mw";

import { isDisallowedMedia } from "./MetaPart";

vi.mock("@/setup/config", () => ({
  conf: () => ({
    DISALLOWED_IDS: ["movie-550", "series-1399", "show-42"],
  }),
}));

describe("isDisallowedMedia", () => {
  it("matches both MWMediaType and PlayerMeta show/movie types", () => {
    expect(isDisallowedMedia("550", MWMediaType.MOVIE)).toBe(true);
    expect(isDisallowedMedia("550", "movie")).toBe(true);
    expect(isDisallowedMedia("1399", MWMediaType.SERIES)).toBe(true);
    expect(isDisallowedMedia("1399", "show")).toBe(true);
    expect(isDisallowedMedia("42", MWMediaType.SERIES)).toBe(true);
    expect(isDisallowedMedia("42", "show")).toBe(true);
    expect(isDisallowedMedia("1399", "movie")).toBe(false);
    expect(isDisallowedMedia("999", "show")).toBe(false);
  });
});
