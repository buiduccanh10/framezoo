import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Icon, Icons } from "@/components/Icon";
import { usePlaybackClock } from "@/components/player/hooks/usePlaybackClock";
import {
  getSegmentBoundsSeconds,
  useSkipTime,
} from "@/components/player/hooks/useSkipTime";
import { isPlaybackInteractionLocked } from "@/components/player/utils/playbackLock";
import { useActiveTorrentStatus } from "@/desktop/torrentPlaybackStore";
import { useProgressBar } from "@/hooks/useProgressBar";
import { usePlayerStore } from "@/stores/player/store";

import { getTorrentPreloadedProgress } from "./torrentProgress";

const SEGMENT_COLORS: Record<
  "intro" | "recap" | "credits" | "preview",
  string
> = {
  intro: "rgba(99, 102, 241, 0.75)", // indigo
  recap: "rgba(245, 158, 11, 0.75)", // amber
  credits: "rgba(34, 197, 94, 0.75)", // green
  preview: "rgba(234, 179, 8, 0.75)", // yellow
};

export function ProgressBar() {
  const { t } = useTranslation();
  const { duration, buffered } = usePlayerStore((s) => s.progress);
  const time = usePlaybackClock();
  const torrentStatus = useActiveTorrentStatus();
  const display = usePlayerStore((s) => s.display);
  const mediaPlaying = usePlayerStore((s) => s.mediaPlaying);
  const subtitleSync = usePlayerStore((s) => s.subtitleSync);
  const setDraggingTime = usePlayerStore((s) => s.setDraggingTime);
  const setSeeking = usePlayerStore((s) => s.setSeeking);
  const { isSeeking } = usePlayerStore((s) => s.interface);
  const segments = useSkipTime();
  const isPlaybackLocked = isPlaybackInteractionLocked(
    mediaPlaying,
    subtitleSync.active,
  );

  const segmentRanges = useMemo(() => {
    if (duration <= 0) return [];
    return segments
      .map((seg) => {
        const bounds = getSegmentBoundsSeconds(seg, duration);
        if (!bounds) return null;

        const endSec = bounds.end ?? duration;
        const left = Math.max(
          0,
          Math.min(100, (bounds.start / duration) * 100),
        );
        const rawWidth = ((endSec - bounds.start) / duration) * 100;
        const width = Math.max(0, Math.min(100 - left, rawWidth));
        if (width <= 0) return null;

        return {
          key: `${seg.type}-${seg.submission_count}-${seg.start_ms ?? "null"}-${
            seg.end_ms ?? "null"
          }`,
          left,
          width,
          color: SEGMENT_COLORS[seg.type],
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [segments, duration]);

  const commitTime = useCallback(
    (percentage: number) => {
      const state = usePlayerStore.getState();
      if (
        isPlaybackInteractionLocked(
          state.mediaPlaying,
          state.subtitleSync.active,
        )
      )
        return;
      display?.setTime(percentage * duration);
    },
    [duration, display],
  );

  const ref = useRef<HTMLDivElement>(null);

  const { dragging, dragPercentage, dragMouseDown } = useProgressBar(
    ref,
    commitTime,
  );
  const guardedDragMouseDown = useCallback(
    (event: Parameters<typeof dragMouseDown>[0]) => {
      const state = usePlayerStore.getState();
      if (
        isPlaybackInteractionLocked(
          state.mediaPlaying,
          state.subtitleSync.active,
        )
      )
        return;
      dragMouseDown(event);
    },
    [dragMouseDown],
  );
  useEffect(() => {
    setSeeking(dragging);
  }, [setSeeking, dragging]);

  useEffect(() => {
    setDraggingTime((dragPercentage / 100) * duration);
  }, [setDraggingTime, duration, dragPercentage]);

  const torrentPreloadedProgress = getTorrentPreloadedProgress(
    buffered,
    duration,
    torrentStatus?.progress ?? 0,
  );
  const syncProgress = Math.round(
    Math.max(0, Math.min(1, subtitleSync.progress)) * 100,
  );
  const aiAccent = "rgb(var(--colors-video-context-type-accent) / 1)";
  const aiProgressFill = "rgb(var(--colors-progress-filled) / 1)";
  const aiEmphasis = "rgb(var(--colors-type-emphasis) / 1)";
  const withAlpha = (color: string, alpha: number) =>
    color.replace("/ 1)", `/ ${alpha})`);
  const syncPhaseLabel =
    subtitleSync.phase === "pausing"
      ? t("player.menus.subtitles.syncSubtitlePreparing", "Preparing audio...")
      : subtitleSync.phase === "applying"
        ? t(
            "player.menus.subtitles.syncSubtitleApplying",
            "Applying subtitle sync...",
          )
        : t(
            "player.menus.subtitles.syncSubtitleWorking",
            "Framezoo is syncing subtitles...",
          );

  return (
    <div className="relative w-full" dir="ltr">
      {subtitleSync.active ? (
        <div className="pointer-events-none absolute bottom-full left-0 right-0 mb-1 flex justify-center">
          <div className="flex items-center gap-2 rounded-full border border-video-context-type-accent/30 bg-video-context-background/90 px-3 py-1 text-xs text-type-emphasis shadow-lg backdrop-blur-sm">
            <span className="relative flex h-4 w-4 items-center justify-center text-video-context-type-accent">
              <span className="absolute inset-[-3px] rounded-full border border-video-context-type-accent/35 motion-safe:animate-ai-progress-orbit" />
              <span className="absolute inset-0 rounded-full bg-video-context-type-accent/20 motion-safe:animate-ping" />
              <Icon
                icon={Icons.WAND}
                className="relative text-sm motion-safe:animate-pulse"
              />
            </span>
            <span className="font-medium">{syncPhaseLabel}</span>
            <span className="min-w-[3ch] text-right font-mono font-semibold text-video-context-type-accent">
              {syncProgress}%
            </span>
          </div>
        </div>
      ) : null}
      <div className="w-full" ref={ref}>
        <div
          className={[
            "group flex h-8 w-full items-center cursor-pointer",
            isPlaybackLocked ? "pointer-events-none" : "",
          ].join(" ")}
          onMouseDown={guardedDragMouseDown}
          onTouchStart={guardedDragMouseDown}
        >
          <div
            className={[
              "relative w-full h-[4px] bg-progress-background bg-opacity-25 rounded-sm transition-[height] duration-100 group-hover:h-[6px]",
              dragging ? "!h-[6px]" : "",
            ].join(" ")}
          >
            {/* Skip segment markers */}
            {segmentRanges.map((range) => (
              <div
                key={range.key}
                className="absolute top-0 bottom-0 rounded-sm pointer-events-none"
                style={{
                  left: `${range.left}%`,
                  width: `${range.width}%`,
                  backgroundColor: range.color,
                }}
              />
            ))}
            {/* Pre-loaded content bar */}
            <div
              className="absolute top-0 left-0 h-full rounded-sm bg-progress-preloaded bg-opacity-50 flex justify-end items-center"
              style={{
                width: `${torrentPreloadedProgress * 100}%`,
              }}
            />

            {/* Actual progress bar */}
            <div
              className="absolute top-0 dir-neutral:left-0 h-full rounded-sm bg-progress-filled flex justify-end items-center"
              style={{
                width: `${
                  Math.max(
                    0,
                    Math.min(
                      1,
                      dragging
                        ? dragPercentage / 100
                        : duration > 0
                          ? time / duration
                          : 0,
                    ),
                  ) * 100
                }%`,
              }}
            >
              <div
                className={[
                  "w-[20px] min-w-[20px] h-[20px] rounded-full transform translate-x-1/2 scale-0 group-hover:scale-100 bg-progress-filled transition-[transform] duration-100 shadow-[0_0_8px_rgba(0,0,0,0.5)]",
                  isSeeking ? "scale-100" : "",
                ].join(" ")}
              />
            </div>

            {subtitleSync.active ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-sm"
              >
                <div
                  className="absolute inset-0 bg-[length:28px_100%] opacity-40 motion-safe:animate-ai-progress-grid"
                  style={{
                    backgroundImage: `linear-gradient(90deg, transparent 0%, ${withAlpha(
                      aiAccent,
                      0.16,
                    )} 50%, transparent 100%)`,
                  }}
                ></div>
                <div
                  className="absolute inset-y-0 left-0 overflow-hidden rounded-sm transition-[width] duration-500 ease-out"
                  style={{
                    width: `${syncProgress}%`,
                    background: `linear-gradient(90deg, ${withAlpha(
                      aiProgressFill,
                      0.25,
                    )}, ${withAlpha(aiAccent, 0.72)}, ${withAlpha(
                      aiProgressFill,
                      0.4,
                    )})`,
                    boxShadow: `0 0 14px ${withAlpha(
                      aiAccent,
                      0.55,
                    )}, inset 0 1px 0 ${withAlpha(aiEmphasis, 0.35)}`,
                  }}
                >
                  <div
                    className="absolute inset-0 bg-[length:220%_100%] motion-safe:animate-ai-progress-shimmer"
                    style={{
                      backgroundImage: `linear-gradient(110deg, transparent 0%, ${withAlpha(
                        aiEmphasis,
                        0.04,
                      )} 35%, ${withAlpha(aiEmphasis, 0.5)} 50%, ${withAlpha(
                        aiEmphasis,
                        0.04,
                      )} 65%, transparent 100%)`,
                    }}
                  />
                </div>
                <div
                  className="absolute inset-y-[-120%] w-14 blur-[2px] motion-safe:animate-ai-progress-scan"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${withAlpha(
                      aiEmphasis,
                      0.78,
                    )}, ${withAlpha(aiAccent, 0.95)}, transparent)`,
                    boxShadow: `0 0 18px ${withAlpha(aiAccent, 0.7)}`,
                  }}
                />
                <div
                  className="absolute inset-y-[-150%] w-px transition-[left] duration-500 ease-out"
                  style={{ left: `${syncProgress}%` }}
                >
                  <div
                    className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full motion-safe:animate-pulse"
                    style={{
                      backgroundColor: aiEmphasis,
                      boxShadow: `0 0 0 3px ${withAlpha(
                        aiAccent,
                        0.16,
                      )}, 0 0 12px ${withAlpha(aiAccent, 0.95)}`,
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
