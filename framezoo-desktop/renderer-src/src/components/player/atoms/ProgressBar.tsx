import { useCallback, useEffect, useMemo, useRef } from "react";

import { usePlaybackClock } from "@/components/player/hooks/usePlaybackClock";
import {
  getSegmentBoundsSeconds,
  useSkipTime,
} from "@/components/player/hooks/useSkipTime";
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
  const { duration, buffered } = usePlayerStore((s) => s.progress);
  const time = usePlaybackClock();
  const torrentStatus = useActiveTorrentStatus();
  const display = usePlayerStore((s) => s.display);
  const setDraggingTime = usePlayerStore((s) => s.setDraggingTime);
  const setSeeking = usePlayerStore((s) => s.setSeeking);
  const { isSeeking } = usePlayerStore((s) => s.interface);
  const segments = useSkipTime();

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
          key: `${seg.type}-${seg.submission_count}-${seg.start_ms ?? "null"}-${seg.end_ms ?? "null"}`,
          left,
          width,
          color: SEGMENT_COLORS[seg.type],
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [segments, duration]);

  const commitTime = useCallback(
    (percentage: number) => {
      display?.setTime(percentage * duration);
    },
    [duration, display],
  );

  const ref = useRef<HTMLDivElement>(null);

  const { dragging, dragPercentage, dragMouseDown } = useProgressBar(
    ref,
    commitTime,
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

  return (
    <div className="w-full relative" dir="ltr">
      <div className="w-full" ref={ref}>
        <div
          className="group w-full h-8 flex items-center cursor-pointer"
          onMouseDown={dragMouseDown}
          onTouchStart={dragMouseDown}
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
          </div>
        </div>
      </div>
    </div>
  );
}
