import { describe, expect, it } from "vitest";

import { compareSearchRankables, scoreSearchTitleMatch } from "./searchRanking";

describe("search ranking", () => {
  it("prefers exact fallback title matches over loose partial matches", () => {
    const exactScore = scoreSearchTitleMatch("taxi driver", [
      "Ẩn Danh",
      "Taxi Driver",
      "모범택시",
    ]);
    const partialScore = scoreSearchTitleMatch("taxi driver", [
      "The Last Taxi Driver",
    ]);

    expect(exactScore).toBeGreaterThan(partialScore);
  });

  it("keeps the stronger per-endpoint hit ahead when title match ties", () => {
    const exactPrimaryShow = {
      titleVariants: ["Ẩn Danh", "Taxi Driver", "모범택시"],
      bestSourceRank: 0,
      hasPrimaryLanguageResult: true,
      vote_count: 190,
    };
    const lowerRankMovie = {
      titleVariants: ["Taxi Driver"],
      bestSourceRank: 1,
      hasPrimaryLanguageResult: true,
      vote_count: 7,
    };

    expect(
      compareSearchRankables("taxi driver", exactPrimaryShow, lowerRankMovie),
    ).toBeLessThan(0);
  });
});
