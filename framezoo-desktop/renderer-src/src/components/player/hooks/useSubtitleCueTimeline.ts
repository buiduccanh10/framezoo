import { useEffect, useReducer, useRef } from "react";

import type { CaptionCueType } from "@/components/player/utils/captions";

type SubtitleTimelineDiagnostics = {
  surface: "main" | "document-pip" | "desktop-pip";
  sourceId?: string | null;
  resetKey: string;
  playbackRate: number;
  isFrozen: boolean;
  isSeeking: boolean;
  isPlaybackStalled: boolean;
  status?: string;
  authoritativeTime?: number;
};

const lastCueDiagnosticAt = new Map<string, number>();
const CUE_DIAGNOSTIC_THROTTLE_MS = 5_000;
const MAX_CUE_DIAGNOSTIC_KEYS = 200;

export function getNextSubtitleCueBoundary(
  cues: CaptionCueType[],
  delay: number,
  currentTime: number,
): number | null {
  let nextBoundary = Number.POSITIVE_INFINITY;
  for (const cue of cues) {
    const start = Math.max(0, cue.start / 1000 + delay);
    const end = Math.max(0, cue.end / 1000 + delay);
    if (start > currentTime) nextBoundary = Math.min(nextBoundary, start);
    if (end > currentTime) nextBoundary = Math.min(nextBoundary, end);
  }
  return Number.isFinite(nextBoundary) ? nextBoundary : null;
}

export function getSkippedSubtitleCueIndices(
  cues: CaptionCueType[],
  delay: number,
  previousTime: number,
  currentTime: number,
): number[] {
  if (currentTime <= previousTime) return [];

  const skipped: number[] = [];
  for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
    const cue = cues[cueIndex];
    const start = Math.max(0, cue.start / 1000 + delay);
    const end = Math.max(0, cue.end / 1000 + delay);
    if (previousTime < start && currentTime >= end) skipped.push(cueIndex);
  }
  return skipped;
}

/** Wake the renderer at the next subtitle start/end, independent of frame cadence. */
export function useSubtitleCueBoundaryWakeup(
  cues: CaptionCueType[],
  delay: number,
  currentTime: number,
  diagnostics: SubtitleTimelineDiagnostics,
) {
  const [boundaryVersion, wake] = useReducer((value: number) => value + 1, 0);
  const previousTimeRef = useRef<{ time: number; resetKey: string } | null>(
    null,
  );

  useEffect(() => {
    const previous = previousTimeRef.current;
    if (previous && previous.resetKey === diagnostics.resetKey) {
      if (!diagnostics.isFrozen && currentTime > previous.time) {
        for (const cueIndex of getSkippedSubtitleCueIndices(
          cues,
          delay,
          previous.time,
          currentTime,
        )) {
          const cue = cues[cueIndex];
          const cueStart = Math.max(0, cue.start / 1000 + delay);
          const cueEnd = Math.max(0, cue.end / 1000 + delay);
          const key = `${diagnostics.surface}:${diagnostics.resetKey}:${cueIndex}:${cueStart}:${cueEnd}`;
          const now = performance.now();
          if (
            now - (lastCueDiagnosticAt.get(key) ?? 0) >=
            CUE_DIAGNOSTIC_THROTTLE_MS
          ) {
            if (lastCueDiagnosticAt.size >= MAX_CUE_DIAGNOSTIC_KEYS) {
              const oldestKey = lastCueDiagnosticAt.keys().next().value;
              if (oldestKey !== undefined)
                lastCueDiagnosticAt.delete(oldestKey);
            }
            lastCueDiagnosticAt.set(key, now);
            console.warn("[subtitle] cue-crossed-without-render", {
              surface: diagnostics.surface,
              sourceId: diagnostics.sourceId ?? null,
              cueIndex,
              cueStart,
              cueEnd,
              previousTime: previous.time,
              currentTime,
              timerAndSubtitleTime: currentTime,
              authoritativeMediaTime: diagnostics.authoritativeTime,
              skippedSeconds: currentTime - previous.time,
              playbackRate: diagnostics.playbackRate,
              status: diagnostics.status,
              isSeeking: diagnostics.isSeeking,
              isPlaybackStalled: diagnostics.isPlaybackStalled,
              isFrozen: diagnostics.isFrozen,
            });
          }
        }
      }
    }
    previousTimeRef.current = {
      time: currentTime,
      resetKey: diagnostics.resetKey,
    };
  }, [
    cues,
    currentTime,
    delay,
    diagnostics.authoritativeTime,
    diagnostics.isFrozen,
    diagnostics.isPlaybackStalled,
    diagnostics.isSeeking,
    diagnostics.playbackRate,
    diagnostics.resetKey,
    diagnostics.sourceId,
    diagnostics.surface,
    diagnostics.status,
  ]);

  useEffect(() => {
    if (diagnostics.isFrozen || diagnostics.playbackRate <= 0) return;

    const nextBoundary = getNextSubtitleCueBoundary(cues, delay, currentTime);
    if (nextBoundary === null) return;

    const timeout = window.setTimeout(
      wake,
      Math.max(
        0,
        ((nextBoundary - currentTime) / diagnostics.playbackRate) * 1000,
      ),
    );
    return () => window.clearTimeout(timeout);
  }, [
    cues,
    currentTime,
    delay,
    diagnostics.isFrozen,
    diagnostics.playbackRate,
    wake,
  ]);

  return boundaryVersion;
}
