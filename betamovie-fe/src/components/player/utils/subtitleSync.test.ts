import { describe, expect, it } from "vitest";

import {
  getAppliedSubtitleSyncOffsetMs,
  getEffectiveSubtitleDelay,
  getSubtitleSyncKey,
  resolveSubtitleSyncSource,
} from "./subtitleSync";

describe("subtitle sync helpers", () => {
  it("adds sync offset to manual delay without persisting it", () => {
    expect(getEffectiveSubtitleDelay(1.25, -720)).toBeCloseTo(0.53);
  });

  it("ignores rejected and in-flight offsets", () => {
    expect(
      getAppliedSubtitleSyncOffsetMs({
        status: "rejected",
        offsetMs: -720,
      }),
    ).toBe(0);
    expect(
      getAppliedSubtitleSyncOffsetMs({
        status: "syncing",
        offsetMs: -720,
      }),
    ).toBe(0);
    expect(
      getAppliedSubtitleSyncOffsetMs({
        status: "applied",
        offsetMs: -720,
      }),
    ).toBe(-720);
  });

  it("scopes a result to media, source, and caption", () => {
    expect(getSubtitleSyncKey("show-1-2-3", "vidlink", "opensubs-9")).toBe(
      "show-1-2-3:vidlink:opensubs-9",
    );
    expect(getSubtitleSyncKey(null, "vidlink", "caption")).toBeNull();
  });

  it("resolves the selected file quality and source headers", () => {
    expect(
      resolveSubtitleSyncSource(
        {
          type: "file",
          qualities: {
            "720": {
              type: "mp4",
              url: "https://example.com/720.mp4",
            },
          },
          preferredHeaders: {
            Referer: "https://example.com",
          },
          headers: {
            "User-Agent": "test",
          },
        },
        "720",
      ),
    ).toEqual({
      type: "file",
      url: "https://example.com/720.mp4",
      headers: {
        Referer: "https://example.com",
        "User-Agent": "test",
      },
    });
  });
});
