import { useEffect, useRef, useState } from "react";

import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

export interface SmoothPlaybackClockOptions {
  time: number;
  duration: number;
  playbackRate: number;
  isActive: boolean;
}

export interface PlaybackClockAnchor {
  time: number;
  timestamp: number;
}

export function getProjectedPlaybackTime(
  anchor: PlaybackClockAnchor,
  now: number,
  playbackRate: number,
  duration: number,
) {
  if (anchor.timestamp <= 0) return anchor.time;

  const elapsed = Math.max(0, now - anchor.timestamp) / 1000;
  return Math.max(
    0,
    Math.min(
      duration > 0 ? duration : Number.POSITIVE_INFINITY,
      anchor.time + elapsed * playbackRate,
    ),
  );
}

export function getMonotonicPlaybackTime(
  authoritativeTime: number,
  projectedTime: number,
  previousTime: number,
  duration: number,
) {
  const nextTime = Math.max(0, authoritativeTime, projectedTime, previousTime);
  return Math.min(duration > 0 ? duration : Number.POSITIVE_INFINITY, nextTime);
}

export function useSmoothPlaybackClock({
  time,
  duration,
  playbackRate,
  isActive,
}: SmoothPlaybackClockOptions): number {
  const [clockTime, setClockTime] = useState(time);
  const clockTimeRef = useRef(time);
  const anchorRef = useRef<PlaybackClockAnchor>({ time, timestamp: 0 });

  useEffect(() => {
    const timestamp = performance.now();
    const previousTime = clockTimeRef.current;
    const projectedTime = getProjectedPlaybackTime(
      anchorRef.current,
      timestamp,
      playbackRate,
      duration,
    );
    const nextTime = isActive
      ? getMonotonicPlaybackTime(time, projectedTime, previousTime, duration)
      : Math.max(
          0,
          Math.min(duration > 0 ? duration : Number.POSITIVE_INFINITY, time),
        );

    anchorRef.current = { time: nextTime, timestamp };
    clockTimeRef.current = nextTime;
    if (nextTime !== previousTime) {
      setClockTime(nextTime);
    }

    if (!isActive || playbackRate <= 0) {
      return;
    }

    let animationFrame = 0;
    const tick = (now: number) => {
      const projected = getProjectedPlaybackTime(
        anchorRef.current,
        now,
        playbackRate,
        duration,
      );
      const next = getMonotonicPlaybackTime(
        clockTimeRef.current,
        projected,
        clockTimeRef.current,
        duration,
      );

      clockTimeRef.current = next;
      setClockTime(next);
      if (duration <= 0 || next < duration) {
        animationFrame = requestAnimationFrame(tick);
      }
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [duration, isActive, playbackRate, time]);

  return clockTime;
}

/**
 * Smooth the visual playback clock between native libmpv time-pos events.
 * The store remains authoritative; this only avoids a frozen/jumping UI clock
 * while decoded frames continue between IPC updates.
 */
export function usePlaybackClock(): number {
  const time = usePlayerStore((s) => s.progress.time);
  const duration = usePlayerStore((s) => s.progress.duration);
  const playbackRate = usePlayerStore((s) => s.mediaPlaying.playbackRate);
  const isPlaying = usePlayerStore((s) => s.mediaPlaying.isPlaying);
  const isPaused = usePlayerStore((s) => s.mediaPlaying.isPaused);
  const isLoading = usePlayerStore((s) => s.mediaPlaying.isLoading);
  const isSeeking = usePlayerStore((s) => s.interface.isSeeking);
  const hasRenderedFrame = usePlayerStore(
    (s) => s.mediaPlaying.hasRenderedFrame,
  );
  const status = usePlayerStore((s) => s.status);

  const isActive =
    isPlaying &&
    !isPaused &&
    !isLoading &&
    !isSeeking &&
    hasRenderedFrame &&
    status === playerStatus.PLAYING &&
    playbackRate > 0;

  return useSmoothPlaybackClock({
    time,
    duration,
    playbackRate,
    isActive,
  });
}
