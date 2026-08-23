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

export const MAX_EXTRAPOLATION_SECONDS = 1.5;
export const SEEK_DISCONTINUITY_BACKWARD_THRESHOLD = 2.5;
export const SEEK_DISCONTINUITY_FORWARD_THRESHOLD = 2.5;

export function getProjectedPlaybackTime(
  anchor: PlaybackClockAnchor,
  now: number,
  playbackRate: number,
  duration: number,
): number {
  if (anchor.timestamp <= 0 || playbackRate <= 0) return anchor.time;

  const elapsed = Math.min(
    MAX_EXTRAPOLATION_SECONDS,
    Math.max(0, now - anchor.timestamp) / 1000,
  );
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
  currentClockTime: number,
  isSeeking: boolean,
  duration: number,
): number {
  const clampedAuth = Math.max(
    0,
    Math.min(
      duration > 0 ? duration : Number.POSITIVE_INFINITY,
      authoritativeTime,
    ),
  );

  const delta = clampedAuth - currentClockTime;
  const isDiscontinuity =
    isSeeking ||
    currentClockTime <= 0 ||
    delta < -SEEK_DISCONTINUITY_BACKWARD_THRESHOLD ||
    delta > SEEK_DISCONTINUITY_FORWARD_THRESHOLD;

  if (isDiscontinuity) {
    return clampedAuth;
  }

  return Math.max(currentClockTime, clampedAuth);
}

export function useSmoothPlaybackClock({
  time,
  duration,
  playbackRate,
  isActive,
  isSeeking = false,
}: SmoothPlaybackClockOptions & { isSeeking?: boolean }): number {
  const [clockTime, setClockTime] = useState(time);
  const clockTimeRef = useRef(time);
  const anchorRef = useRef<PlaybackClockAnchor>({
    time,
    timestamp: isActive ? performance.now() : 0,
  });

  useEffect(() => {
    const now = performance.now();
    const clampedTime = Math.max(
      0,
      Math.min(duration > 0 ? duration : Number.POSITIVE_INFINITY, time),
    );
    const previousTime = clockTimeRef.current;
    const delta = clampedTime - previousTime;

    const isDiscontinuity =
      isSeeking ||
      previousTime <= 0 ||
      delta < -SEEK_DISCONTINUITY_BACKWARD_THRESHOLD ||
      delta > SEEK_DISCONTINUITY_FORWARD_THRESHOLD;

    if (isDiscontinuity) {
      anchorRef.current = {
        time: clampedTime,
        timestamp: isActive ? now : 0,
      };
      clockTimeRef.current = clampedTime;
      setClockTime(clampedTime);
    } else if (clampedTime > previousTime) {
      anchorRef.current = {
        time: clampedTime,
        timestamp: isActive ? now : 0,
      };
      clockTimeRef.current = clampedTime;
      setClockTime(clampedTime);
    } else if (!isActive) {
      // Clock is paused (e.g. buffering / isLoading). Explicitly zero out the
      // anchor timestamp so that when the clock reactivates the rAF does NOT
      // extrapolate from a stale past timestamp (which would cause a spurious
      // forward jump followed by a backward discontinuity snap).
      // We must preserve the original anchor.time to avoid committing extrapolated time.
      anchorRef.current = {
        time: anchorRef.current.time,
        timestamp: 0,
      };
    } else if (anchorRef.current.timestamp <= 0) {
      // Clock just reactivated (isActive: false → true) but time hasn't
      // advanced yet to trigger the forward branch. Refresh the anchor to
      // now so the rAF extrapolates from the present, not a stale moment.
      anchorRef.current = {
        time: anchorRef.current.time,
        timestamp: now,
      };
    }

    if (!isActive || playbackRate <= 0) {
      return;
    }

    let animationFrame = 0;
    const tick = (frameNow: number) => {
      const projected = getProjectedPlaybackTime(
        anchorRef.current,
        frameNow,
        playbackRate,
        duration,
      );
      const next = Math.max(clockTimeRef.current, projected);

      if (next !== clockTimeRef.current) {
        clockTimeRef.current = next;
        setClockTime(next);
      }

      if (duration <= 0 || next < duration) {
        animationFrame = requestAnimationFrame(tick);
      }
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [duration, isActive, isSeeking, playbackRate, time]);

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
  const isSeeking = usePlayerStore((s) => s.interface.isSeeking);
  const isLoading = usePlayerStore((s) => s.mediaPlaying.isLoading);
  const hasRenderedFrame = usePlayerStore(
    (s) => s.mediaPlaying.hasRenderedFrame,
  );
  const status = usePlayerStore((s) => s.status);

  const isActive =
    isPlaying &&
    !isPaused &&
    !isSeeking &&
    !isLoading &&
    hasRenderedFrame &&
    status === playerStatus.PLAYING &&
    playbackRate > 0;

  return useSmoothPlaybackClock({
    time,
    duration,
    playbackRate,
    isActive,
    isSeeking,
  });
}
