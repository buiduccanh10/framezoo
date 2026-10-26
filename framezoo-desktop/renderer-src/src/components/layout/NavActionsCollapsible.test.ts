import { describe, expect, it } from "vitest";

import { getFreeSpacePercent } from "./NavActionsCollapsible";

describe("getFreeSpacePercent", () => {
  it("calculates and clamps remaining disk percentage", () => {
    expect(getFreeSpacePercent(25, 100)).toBe(25);
    expect(getFreeSpacePercent(-1, 100)).toBe(0);
    expect(getFreeSpacePercent(200, 100)).toBe(100);
    expect(getFreeSpacePercent(1, 0)).toBeNull();
  });
});
