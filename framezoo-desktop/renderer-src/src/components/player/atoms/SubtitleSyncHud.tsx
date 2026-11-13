import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon, Icons } from "@/components/Icon";
import { cancelActiveSubtitleSync } from "@/components/player/hooks/useCaptions";
import { Transition } from "@/components/utils/Transition";
import type {
  SubtitleSyncStage,
  SubtitleSyncState,
  SubtitleSyncWindowInfo,
} from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { formatSeconds } from "@/utils/formatSeconds";

export interface DerivedSubtitleSyncHudView {
  percent: number;
  rawProgress: number;
  activeStepIndex: 0 | 1 | 2 | 3;
  effectiveStage: SubtitleSyncStage;
  elapsedSecondsText: string;
}

const HUD_TICK_MS = 120;

export function deriveSubtitleSyncHudView(
  subtitleSync: SubtitleSyncState,
  nowMs = Date.now(),
): DerivedSubtitleSyncHudView {
  const baseProgress = Number.isFinite(subtitleSync.progress)
    ? Math.max(0, Math.min(1, subtitleSync.progress))
    : 0;

  let rawProgress = baseProgress;
  let effectiveStage: SubtitleSyncStage = subtitleSync.stage ?? "vad";

  if (subtitleSync.phase === "preparing") {
    rawProgress = Math.max(baseProgress, 0.52);
    effectiveStage = "upload";
  } else if (subtitleSync.phase === "analyzing") {
    if (subtitleSync.stage === "consensus" || baseProgress >= 0.93) {
      rawProgress = Math.max(baseProgress, 0.94);
      effectiveStage = "consensus";
    } else {
      const anchorMs =
        subtitleSync.phaseStartedAt ?? subtitleSync.startedAt ?? nowMs;
      const elapsedAnalyzeMs = Math.max(0, nowMs - anchorMs);
      const asymptotic = 0.58 + 0.34 * (1 - Math.exp(-elapsedAnalyzeMs / 3600));
      rawProgress = Math.max(baseProgress, Math.min(0.92, asymptotic));
      effectiveStage =
        rawProgress < 0.72
          ? "vad"
          : rawProgress < 0.85
            ? "correlate"
            : "consensus";
    }
  } else if (subtitleSync.phase === "applying") {
    rawProgress = 1;
    effectiveStage = "consensus";
  }

  let activeStepIndex: 0 | 1 | 2 | 3 = 0;
  if (subtitleSync.phase === "applying") {
    activeStepIndex = 3;
  } else if (subtitleSync.phase === "analyzing") {
    activeStepIndex = effectiveStage === "vad" ? 1 : 2;
  } else if (subtitleSync.phase === "preparing") {
    activeStepIndex = 1;
  }

  const elapsedMs = subtitleSync.startedAt
    ? Math.max(0, nowMs - subtitleSync.startedAt)
    : 0;

  return {
    percent: Math.round(rawProgress * 100),
    rawProgress,
    activeStepIndex,
    effectiveStage,
    elapsedSecondsText: `${(elapsedMs / 1000).toFixed(1)}s`,
  };
}

export function useSubtitleSyncTelemetry() {
  const subtitleSync = usePlayerStore((s) => s.subtitleSync);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!subtitleSync.active) return undefined;
    setNowMs(Date.now());
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, HUD_TICK_MS);
    return () => window.clearInterval(interval);
  }, [subtitleSync.active, subtitleSync.phase, subtitleSync.phaseStartedAt]);

  const derived = useMemo(
    () => deriveSubtitleSyncHudView(subtitleSync, nowMs),
    [subtitleSync, nowMs],
  );

  return {
    subtitleSync,
    ...derived,
  };
}

function getProbeChipClasses(status: SubtitleSyncWindowInfo["status"]): string {
  switch (status) {
    case "capturing":
      return "border-video-context-type-accent/70 bg-video-context-type-accent/15 text-white";
    case "captured":
      return "border-white/15 bg-white/[0.08] text-white/90";
    case "failed":
      return "border-white/10 bg-transparent text-video-context-type-secondary opacity-45 line-through";
    default:
      return "border-white/10 bg-white/[0.03] text-video-context-type-secondary";
  }
}

export function SubtitleSyncHud() {
  const { t } = useTranslation();
  const {
    subtitleSync,
    percent,
    activeStepIndex,
    effectiveStage,
    elapsedSecondsText,
  } = useSubtitleSyncTelemetry();

  const windows = subtitleSync.windows ?? [];
  const totalWindows = subtitleSync.totalWindows ?? windows.length;
  const capturedCount =
    subtitleSync.capturedCount ??
    windows.filter((item) => item.status === "captured").length;

  let phaseLabel = t(
    "player.menus.subtitles.syncSubtitleWorking",
    "Framezoo is syncing subtitles...",
  );
  if (subtitleSync.phase === "pausing") {
    phaseLabel = t(
      "player.menus.subtitles.syncSubtitlePreparing",
      "Preparing audio...",
    );
  } else if (subtitleSync.phase === "capturing") {
    phaseLabel = t(
      "player.menus.subtitles.syncSubtitlePreparingAudio",
      "Preparing audio to sync...",
    );
  } else if (subtitleSync.phase === "preparing") {
    phaseLabel = t(
      "player.menus.subtitles.syncPhasePreparing",
      "Encoding acoustic tensors...",
    );
  } else if (subtitleSync.phase === "analyzing") {
    if (effectiveStage === "vad") {
      phaseLabel = t(
        "player.menus.subtitles.syncPhaseVad",
        "Isolating spoken dialogue (VAD)...",
      );
    } else if (effectiveStage === "consensus") {
      phaseLabel = t(
        "player.menus.subtitles.syncPhaseConsensus",
        "Verifying multi-window consensus...",
      );
    } else {
      phaseLabel = t(
        "player.menus.subtitles.syncPhaseCorrelate",
        "Scanning offset & FPS drift spectrum...",
      );
    }
  } else if (subtitleSync.phase === "applying") {
    phaseLabel = t(
      "player.menus.subtitles.syncSubtitleApplying",
      "Applying subtitle sync...",
    );
  }

  const steps = [
    t("player.menus.subtitles.syncStageSample", "Audio Scan"),
    t("player.menus.subtitles.syncStageVad", "Voice VAD"),
    t("player.menus.subtitles.syncStageCorrelate", "Align Drift"),
    t("player.menus.subtitles.syncStageLock", "Lock Sync"),
  ];

  return (
    <Transition
      animation="fade"
      show={subtitleSync.active}
      className="pointer-events-none fixed inset-0 z-[56] flex items-center justify-center px-4 pb-20 sm:pb-24"
    >
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto w-full max-w-[384px] rounded-xl border border-video-context-border/70 bg-video-context-background/95 p-4 text-white shadow-2xl backdrop-blur-md"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-video-context-type-accent/15 text-video-context-type-accent">
              <Icon
                icon={Icons.WAND}
                className="text-sm motion-safe:animate-pulse"
              />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">
                {phaseLabel}
              </p>
              <p className="text-[11px] text-video-context-type-secondary tabular-nums">
                {totalWindows > 0
                  ? `${capturedCount}/${totalWindows} · ${elapsedSecondsText}`
                  : elapsedSecondsText}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-sm font-semibold text-video-context-type-accent tabular-nums">
              {percent}%
            </span>
            <button
              type="button"
              onClick={cancelActiveSubtitleSync}
              aria-label={t("actions.cancel", "Cancel")}
              title={t("actions.cancel", "Cancel")}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-video-context-type-secondary transition-colors hover:bg-video-context-hoverColor hover:text-white"
            >
              <Icon icon={Icons.X} className="text-xs" />
            </button>
          </div>
        </div>

        <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-video-context-type-accent transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>

        {windows.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {windows.map((probe) => (
              <span
                key={probe.index}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] tabular-nums transition-colors duration-200 ${getProbeChipClasses(probe.status)}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    probe.status === "capturing"
                      ? "bg-video-context-type-accent motion-safe:animate-pulse"
                      : probe.status === "captured"
                        ? "bg-video-context-type-accent"
                        : "bg-white/25"
                  }`}
                />
                {formatSeconds(probe.startAt, probe.startAt >= 3600)}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-2.5 text-[11px]">
          {steps.map((label, idx) => {
            const isDone = idx < activeStepIndex;
            const isActive = idx === activeStepIndex;
            return (
              <span
                key={label}
                className={`truncate transition-colors ${
                  isActive
                    ? "font-semibold text-white"
                    : isDone
                      ? "text-video-context-type-accent"
                      : "text-video-context-type-secondary/75"
                }`}
              >
                {label}
              </span>
            );
          })}
        </div>
      </div>
    </Transition>
  );
}
