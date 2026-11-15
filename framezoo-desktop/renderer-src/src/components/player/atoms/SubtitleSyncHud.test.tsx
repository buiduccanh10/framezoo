import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hudMocks = vi.hoisted(() => ({
  cancelActiveSubtitleSync: vi.fn(),
}));

vi.mock("@/components/player/hooks/useCaptions", () => ({
  cancelActiveSubtitleSync: hudMocks.cancelActiveSubtitleSync,
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (
        key: string,
        options?: string | { defaultValue?: string; [k: string]: unknown },
      ) => {
        if (typeof options === "string") return options;
        const template = options?.defaultValue ?? key;
        return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) =>
          String(options?.[token] ?? ""),
        );
      },
    }),
  };
});

import { PlaybackClockProvider } from "@/components/player/hooks/usePlaybackClock";
import { usePlayerStore } from "@/stores/player/store";

import { ProgressBar } from "./ProgressBar";
import { SubtitleSyncHud, deriveSubtitleSyncHudView } from "./SubtitleSyncHud";

describe("deriveSubtitleSyncHudView", () => {
  it("keeps smooth asymptotic progression across analyzing sub-stages without stalling", () => {
    const startMs = 1_000_000;
    const baseState = {
      active: true,
      phase: "analyzing" as const,
      progress: 0.58,
      stage: "vad" as const,
      startedAt: startMs,
      phaseStartedAt: startMs + 2_000,
    };

    const early = deriveSubtitleSyncHudView(baseState, startMs + 2_500);
    expect(early.percent).toBeGreaterThanOrEqual(58);
    expect(early.percent).toBeLessThan(72);
    expect(early.effectiveStage).toBe("vad");
    expect(early.activeStepIndex).toBe(1);

    const middle = deriveSubtitleSyncHudView(baseState, startMs + 5_500);
    expect(middle.percent).toBeGreaterThan(early.percent);
    expect(middle.effectiveStage).toBe("correlate");
    expect(middle.activeStepIndex).toBe(2);
    expect(middle.elapsedSecondsText).toBe("5.5s");

    const locked = deriveSubtitleSyncHudView(
      {
        ...baseState,
        phase: "applying",
        progress: 1,
      },
      startMs + 8_000,
    );
    expect(locked.percent).toBe(100);
    expect(locked.activeStepIndex).toBe(3);
  });
});

describe("SubtitleSyncHud", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    hudMocks.cancelActiveSubtitleSync.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    usePlayerStore.getState().setSubtitleSyncState({
      active: false,
      phase: "idle",
      progress: 0,
    });
  });

  it("stays hidden when subtitle sync is idle", async () => {
    usePlayerStore.getState().setSubtitleSyncState({
      active: false,
      phase: "idle",
      progress: 0,
    });

    await act(async () => {
      root.render(createElement(SubtitleSyncHud));
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("renders neural telemetry, timeline probes, pipeline steps, and cancel control", async () => {
    const now = Date.now();
    usePlayerStore.getState().setSubtitleSyncState({
      active: true,
      phase: "capturing",
      progress: 0.34,
      startedAt: now - 2_300,
      phaseStartedAt: now - 2_100,
      capturedCount: 2,
      totalWindows: 4,
      windows: [
        {
          index: 0,
          startAt: 600,
          duration: 60,
          priority: "nearby",
          status: "captured",
        },
        {
          index: 1,
          startAt: 840,
          duration: 60,
          priority: "buffered",
          status: "captured",
        },
        {
          index: 2,
          startAt: 1239,
          duration: 60,
          priority: "fallback",
          status: "capturing",
        },
        {
          index: 3,
          startAt: 1947,
          duration: 60,
          priority: "fallback",
          status: "queued",
        },
      ],
    });

    await act(async () => {
      root.render(createElement(SubtitleSyncHud));
    });

    const hud = container.querySelector('[role="status"]');
    expect(hud).not.toBeNull();
    expect(hud?.textContent).not.toContain("NEURAL AI");
    expect(hud?.textContent).toContain("34%");
    expect(hud?.textContent).toContain("2/4");
    expect(hud?.textContent).toContain("10:00");
    expect(hud?.textContent).toContain("14:00");
    expect(hud?.textContent).toContain("20:39");
    expect(hud?.textContent).toContain("32:27");
    expect(hud?.textContent).toContain("Audio Scan");
    expect(hud?.textContent).toContain("Lock Sync");

    const cancelButton = container.querySelector(
      'button[aria-label="Cancel"]',
    ) as HTMLButtonElement | null;
    expect(cancelButton).not.toBeNull();
    cancelButton?.click();
    expect(hudMocks.cancelActiveSubtitleSync).toHaveBeenCalledTimes(1);
  });

  it("renders only audio window markers on ProgressBar during subtitle sync without duplicate sync progress fill", async () => {
    const now = Date.now();
    usePlayerStore.setState((state) => ({
      progress: {
        ...state.progress,
        duration: 1000,
        buffered: 0,
        time: 100,
      },
    }));
    usePlayerStore.getState().setSubtitleSyncState({
      active: true,
      phase: "capturing",
      progress: 0.42,
      startedAt: now - 1_000,
      phaseStartedAt: now - 1_000,
      capturedCount: 1,
      totalWindows: 2,
      windows: [
        {
          index: 0,
          startAt: 200,
          duration: 60,
          priority: "nearby",
          status: "captured",
        },
        {
          index: 1,
          startAt: 500,
          duration: 60,
          priority: "buffered",
          status: "capturing",
        },
      ],
    });

    await act(async () => {
      root.render(
        createElement(PlaybackClockProvider, null, createElement(ProgressBar)),
      );
    });

    expect(container.querySelector(".animate-ai-progress-grid")).toBeNull();
    expect(container.querySelector(".animate-ai-progress-shimmer")).toBeNull();
    expect(container.querySelector(".animate-ai-progress-scan")).toBeNull();

    const capturedMarker = container.querySelector(
      '[style*="left: 20%"][style*="width: 6%"]',
    );
    const capturingMarker = container.querySelector(
      '[style*="left: 50%"][style*="width: 6%"]',
    );
    expect(capturedMarker).not.toBeNull();
    expect(capturingMarker).not.toBeNull();

    usePlayerStore.setState((state) => ({
      progress: {
        ...state.progress,
        duration: 0,
        buffered: 0,
        time: 0,
      },
    }));
  });
});
