import { describe, expect, it } from "vitest";

import { formatDownloadCount } from "./HeroSection";

describe("formatDownloadCount", () => {
  it("formats counts under 100 with a plus", () => {
    expect(formatDownloadCount(42)).toBe("42+");
  });

  it("rounds counts between 100 and 999 to the nearest lower 10 with a plus", () => {
    expect(formatDownloadCount(593)).toBe("590+");
    expect(formatDownloadCount(605)).toBe("600+");
    expect(formatDownloadCount(100)).toBe("100+");
  });

  it("formats counts 1000 and above into thousands with k+", () => {
    expect(formatDownloadCount(1000)).toBe("1k+");
    expect(formatDownloadCount(1050)).toBe("1.1k+");
    expect(formatDownloadCount(4324)).toBe("4.3k+");
  });
});
