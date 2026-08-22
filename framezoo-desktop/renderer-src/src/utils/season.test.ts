import { describe, expect, it } from "vitest";

import {
  formatEpisodeTitle,
  formatSeasonTitle,
  hasGenericEpisodeTitle,
} from "./season";

const mockT = ((key: string, options?: any) => {
  if (key === "details.episodeNumber") {
    return `Tập ${options?.number}`;
  }
  if (key === "details.season") {
    return "Mùa";
  }
  if (key === "details.specialSeason") {
    return "Mùa đặc biệt";
  }
  if (key === "player.menus.episodes.specials") {
    return "Đặc biệt";
  }
  if (key === "player.menus.episodes.loadingTitle") {
    return "Đang tải...";
  }
  return key;
}) as any;

describe("hasGenericEpisodeTitle", () => {
  it("returns true for null or empty titles", () => {
    expect(hasGenericEpisodeTitle(null, 1)).toBe(true);
    expect(hasGenericEpisodeTitle(undefined, 1)).toBe(true);
    expect(hasGenericEpisodeTitle("", 1)).toBe(true);
    expect(hasGenericEpisodeTitle("   ", 1)).toBe(true);
  });

  it("detects generic episode titles with episode number", () => {
    expect(hasGenericEpisodeTitle("Episode 7", 7)).toBe(true);
    expect(hasGenericEpisodeTitle("episode 7", 7)).toBe(true);
    expect(hasGenericEpisodeTitle("EPISODE 7", 7)).toBe(true);
    expect(hasGenericEpisodeTitle("Ep 7", 7)).toBe(true);
    expect(hasGenericEpisodeTitle("ep 7", 7)).toBe(true);
    expect(hasGenericEpisodeTitle("Ep. 7", 7)).toBe(true);
    expect(hasGenericEpisodeTitle("ep. 7", 7)).toBe(true);
    expect(hasGenericEpisodeTitle("Episode 07", 7)).toBe(true);
    expect(hasGenericEpisodeTitle("Tập 7", 7)).toBe(true);
    expect(hasGenericEpisodeTitle("tap 7", 7)).toBe(true);
    expect(hasGenericEpisodeTitle("Episode", 7)).toBe(true);
    expect(hasGenericEpisodeTitle("Ep", 7)).toBe(true);
  });

  it("returns false for non-generic episode titles", () => {
    expect(hasGenericEpisodeTitle("Pilot", 1)).toBe(false);
    expect(hasGenericEpisodeTitle("That Night, A Forest Grew", 7)).toBe(false);
    expect(hasGenericEpisodeTitle("Episode 7: The Return", 7)).toBe(false);
    expect(hasGenericEpisodeTitle("Episode 8", 7)).toBe(false);
  });
});

describe("formatEpisodeTitle", () => {
  it("translates generic episode titles using i18n", () => {
    expect(formatEpisodeTitle("Episode 7", 7, mockT)).toBe("Tập 7");
    expect(formatEpisodeTitle("ep 7", 7, mockT)).toBe("Tập 7");
    expect(formatEpisodeTitle(null, 7, mockT)).toBe("Tập 7");
    expect(formatEpisodeTitle(undefined, 7, mockT)).toBe("Tập 7");
  });

  it("preserves named non-generic titles", () => {
    expect(formatEpisodeTitle("That Night, A Forest Grew", 7, mockT)).toBe(
      "That Night, A Forest Grew",
    );
    expect(formatEpisodeTitle("Pilot", 1, mockT)).toBe("Pilot");
  });
});

describe("formatSeasonTitle", () => {
  it("formats specials", () => {
    expect(formatSeasonTitle("Specials", 0, mockT)).toBe("Đặc biệt");
    expect(formatSeasonTitle("Specials", 1, mockT)).toBe("Đặc biệt");
    expect(formatSeasonTitle("Specials", 1, mockT, "season")).toBe(
      "Mùa đặc biệt",
    );
  });

  it("formats generic season numbers", () => {
    expect(formatSeasonTitle("Season 2", 2, mockT)).toBe("Mùa 2");
    expect(formatSeasonTitle(undefined, 2, mockT)).toBe("Mùa 2");
  });

  it("preserves named seasons", () => {
    expect(formatSeasonTitle("Book 1: Water", 1, mockT)).toBe("Book 1: Water");
  });
});
