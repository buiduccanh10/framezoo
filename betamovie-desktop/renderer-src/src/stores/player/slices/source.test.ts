import { afterEach, describe, expect, it } from "vitest";

import { usePlayerStore } from "@/stores/player/store";

describe("subtitle sync store lifecycle", () => {
  afterEach(() => {
    usePlayerStore.getState().reset();
  });

  it("ignores a stale result from an earlier run with the same key", () => {
    const store = usePlayerStore.getState();
    const firstRequestId = store.beginSubtitleSync("movie-1:source:caption");
    const secondRequestId = usePlayerStore
      .getState()
      .beginSubtitleSync("movie-1:source:caption");

    usePlayerStore
      .getState()
      .setSubtitleSyncResult("movie-1:source:caption", firstRequestId, {
        status: "applied",
        offsetMs: -720,
        confidence: "high",
        matchedCueCount: 12,
        driftMs: 80,
        reason: null,
        cached: false,
      });

    expect(usePlayerStore.getState().subtitleSync.status).toBe("syncing");

    usePlayerStore
      .getState()
      .setSubtitleSyncResult("movie-1:source:caption", secondRequestId, {
        status: "applied",
        offsetMs: -680,
        confidence: "high",
        matchedCueCount: 10,
        driftMs: 60,
        reason: null,
        cached: true,
      });

    expect(usePlayerStore.getState().subtitleSync).toMatchObject({
      status: "applied",
      offsetMs: -680,
      cached: true,
    });
  });
});
