import { useEffect, useRef, useState } from "react";

import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

export interface SmoothPlaybackClockOptions {
  time: number;
  duration: number;
  playbackRate: number;
  isActive: boolean;
  resetKey?: string | number | null;
}

export interface PlaybackClockAnchor {
  time: number;
  timestamp: number;
}

export const MAX_EXTRAPOLATION_SECONDS = 10.0;
export const SEEK_DISCONTINUITY_BACKWARD_THRESHOLD = 0.5;
export const SEEK_DISCONTINUITY_FORWARD_THRESHOLD = 0.5;

export function shouldSnapPlaybackClock(
  authoritativeTime: number,
  anchorTime: number,
  isSeeking: boolean,
  seekInProgress: boolean,
  clockIdentityChanged: boolean,
): boolean {
  const authoritativeTimeChanged = authoritativeTime !== anchorTime;
  const anchorDelta = authoritativeTime - anchorTime;

  return (
    ((isSeeking || seekInProgress) && authoritativeTimeChanged) ||
    clockIdentityChanged ||
    anchorDelta > SEEK_DISCONTINUITY_FORWARD_THRESHOLD
  );
}

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
  resetKey = null,
}: SmoothPlaybackClockOptions & { isSeeking?: boolean }): number {
  const [clockTime, setClockTime] = useState(time);
  const clockTimeRef = useRef(time);
  const seekInProgressRef = useRef(false);
  const resetKeyRef = useRef(resetKey);
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
    const previousAnchorTime = anchorRef.current.time;
    const authoritativeTimeChanged = clampedTime !== previousAnchorTime;
    const clockIdentityChanged = resetKey !== resetKeyRef.current;

    if (isSeeking) {
      seekInProgressRef.current = true;
    }
    if (clockIdentityChanged) {
      resetKeyRef.current = resetKey;
    }
    const isDiscontinuity = shouldSnapPlaybackClock(
      clampedTime,
      previousAnchorTime,
      isSeeking,
      seekInProgressRef.current,
      clockIdentityChanged,
    );

    if (isDiscontinuity) {
      anchorRef.current = {
        time: clampedTime,
        timestamp: isActive ? now : 0,
      };
      clockTimeRef.current = clampedTime;
      setClockTime(clampedTime);
      if (!isSeeking) {
        seekInProgressRef.current = false;
      }
    } else if (authoritativeTimeChanged) {
      // Re-anchor every native sample without applying small stale samples
      // to the visual clock. This removes IPC jitter without accumulating drift.
      anchorRef.current = {
        time: clampedTime,
        timestamp: isActive ? now : 0,
      };
      const nextTime = getMonotonicPlaybackTime(
        clampedTime,
        previousTime,
        false,
        duration,
      );
      if (nextTime !== previousTime) {
        clockTimeRef.current = nextTime;
        setClockTime(nextTime);
      }
    } else if (isActive && anchorRef.current.timestamp <= 0) {
      // Resume from the frozen visual clock without extrapolating through the
      // paused/buffering interval.
      anchorRef.current = {
        time: anchorRef.current.time,
        timestamp: now,
      };
    }

    if (!isActive || playbackRate <= 0) {
      // Never replace the visual clock with a delayed pause/buffer sample.
      // Source/seek resets still use the discontinuity branch above.
      anchorRef.current.timestamp = 0;
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

      // Throttle React state updates to ~30fps to save CPU (0.033s delta)
      if (Math.abs(next - clockTimeRef.current) >= 0.033) {
        clockTimeRef.current = next;
        setClockTime(next);
      }

      if (duration <= 0 || next < duration) {
        animationFrame = requestAnimationFrame(tick);
      }
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [duration, isActive, isSeeking, playbackRate, resetKey, time]);

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
  const clockResetKey = usePlayerStore((s) =>
    [
      s.meta?.type ?? "",
      s.meta?.tmdbId ?? "",
      s.meta?.episode?.tmdbId ?? "",
      s.sourceId ?? "",
      s.source?.type ?? "",
      s.currentQuality ?? "",
    ].join("|"),
  );
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
    resetKey: clockResetKey,
  });
}
