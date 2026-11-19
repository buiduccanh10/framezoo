import { describe, expect, it } from "vitest";

import {
  computePrefetchEnd,
  computeWireTargetQueue,
  isPrefetchSeek,
  shouldHotswapBlock,
} from "./worker";

describe("wire BDP scheduler helpers", () => {
  it("sizes per-wire request pipeline cleanly from untested -> slow -> fast BDP", () => {
    // Untested peer gets a small probe queue of 4 blocks.
    expect(computeWireTargetQueue(0, 0, 80, 1.2)).toBe(4);
    // Slow peer (< 48 KiB/s) stays capped at 2 blocks.
    expect(computeWireTargetQueue(5, 16 * 1024, 80, 1.2)).toBe(2);
    // Healthy peer scales linearly with speed * bdpSeconds, clamped to [8 .. maxQueuePerWire].
    expect(computeWireTargetQueue(5, 100 * 1024, 80, 1.2)).toBe(8);
    expect(computeWireTargetQueue(10, 800 * 1024, 80, 1.2)).toBe(60);
    expect(computeWireTargetQueue(50, 4_000 * 1024, 80, 1.2)).toBe(80);
  });

  it("only hotswaps urgent blocks on genuine wire stalls or >=2x faster takeover", () => {
    const now = 10_000;
    // Active fast seeder with deep queue: owner got data 200ms ago, req sent 700ms ago -> DO NOT cancel!
    expect(shouldHotswapBlock(now, now - 700, now - 200, 1_000_000, 1_200_000)).toBe(
      false,
    );
    // Owner went silent > 1200ms -> hotswap even if candidate speed is modest.
    expect(shouldHotswapBlock(now, now - 1_500, now - 1_300, 200_000, 50_000)).toBe(
      true,
    );
    // Slow owner (20 KB/s) held block > 350ms while fast candidate (300 KB/s >= 120 KB/s) is idle -> takeover.
    expect(shouldHotswapBlock(now, now - 400, now - 400, 20_000, 300_000)).toBe(
      true,
    );
    // Below 350ms age -> let owner finish first.
    expect(shouldHotswapBlock(now, now - 200, now - 200, 20_000, 500_000)).toBe(
      false,
    );
  });
});

describe("prefetch helpers", () => {
  it("downloads continuously to EOF unless cache is disabled or reached maxBytes", () => {
    expect(computePrefetchEnd(10, 500, 64, null, 1_000_000_000)).toBe(500);
    expect(computePrefetchEnd(10, 500, 64, 2_000_000, 1_000_000)).toBe(500);
    expect(computePrefetchEnd(10, 500, 64, 2_000_000, 2_000_000)).toBe(73);
    expect(computePrefetchEnd(10, 500, 64, 0, 0)).toBe(73);
  });

  it("treats sequential advance and in-frontier reads as continuous, and out-of-range as seek", () => {
    expect(isPrefetchSeek(true, 15, 10, 80)).toBe(false);
    expect(isPrefetchSeek(true, 82, 10, 80)).toBe(false);
    expect(isPrefetchSeek(true, 9, 10, 80)).toBe(true);
    expect(isPrefetchSeek(true, 83, 10, 80)).toBe(true);
    expect(isPrefetchSeek(false, 15, 10, 80)).toBe(true);
  });
});
