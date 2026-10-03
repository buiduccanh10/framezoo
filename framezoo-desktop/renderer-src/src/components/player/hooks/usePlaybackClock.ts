import { useEffect, useMemo, useRef, useState } from "react";

import { getMediaKey, playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

export type PlaybackClockResetKey = string | number | null | undefined;

export interface SmoothPlaybackClockOptions {
  time: number;
  duration: number;
  playbackRate: number;
  isActive: boolean;
  isLoading?: boolean;
  isSeeking?: boolean;
  tickIntervalMs?: number;
  resetKey?: PlaybackClockResetKey;
}

export interface PlaybackClockAnchor {
  time: number;
  timestamp: number;
}

export interface PlaybackClockState {
  anchor: PlaybackClockAnchor;
  time: number;
  playbackRate: number;
  isRunning: boolean;
  resetKey: PlaybackClockResetKey;
  authoritativeTime?: number;
}

export const MAX_EXTRAPOLATION_SECONDS = 10.0;
export const SEEK_DISCONTINUITY_FORWARD_THRESHOLD = 0.5;
export const SEEK_DISCONTINUITY_BACKWARD_THRESHOLD = 0.5;
export const VISUAL_PLAYBACK_CLOCK_TICK_MS = 33;
export const SUBTITLE_PLAYBACK_CLOCK_TICK_MS = 50;

function clampPlaybackTime(time: number, duration: number): number {
  return Math.max(
    0,
    Math.min(duration > 0 ? duration : Number.POSITIVE_INFINITY, time),
  );
}

function isClockRunning(input: SmoothPlaybackClockOptions): boolean {
  return input.isActive && !input.isLoading && input.playbackRate > 0;
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
  return clampPlaybackTime(anchor.time + elapsed * playbackRate, duration);
}

function getClockTime(
  state: PlaybackClockState,
  duration: number,
  now: number,
): number {
  if (!state.isRunning) return clampPlaybackTime(state.time, duration);

  return Math.max(
    clampPlaybackTime(state.time, duration),
    getProjectedPlaybackTime(state.anchor, now, state.playbackRate, duration),
  );
}

export function createPlaybackClockState(
  input: SmoothPlaybackClockOptions,
  now: number,
): PlaybackClockState {
  const time = clampPlaybackTime(input.time, input.duration);
  const isRunning = isClockRunning(input);

  return {
    anchor: { time, timestamp: isRunning ? now : 0 },
    time,
    playbackRate: input.playbackRate,
    isRunning,
    resetKey: input.resetKey,
    authoritativeTime: time,
  };
}

export function shouldSnapPlaybackClock(
  state: PlaybackClockState,
  input: SmoothPlaybackClockOptions,
  now: number,
): boolean {
  const authoritativeTime = clampPlaybackTime(input.time, input.duration);
  const currentTime = getClockTime(state, input.duration, now);
  const forwardDiscontinuity =
    authoritativeTime - currentTime > SEEK_DISCONTINUITY_FORWARD_THRESHOLD;
  const backwardDiscontinuity =
    state.authoritativeTime !== undefined &&
    state.authoritativeTime - authoritativeTime >
      SEEK_DISCONTINUITY_BACKWARD_THRESHOLD;

  return (
    state.resetKey !== input.resetKey ||
    Boolean(input.isSeeking) ||
    (!input.isLoading && (forwardDiscontinuity || backwardDiscontinuity))
  );
}

/**
 * Reconcile sparse native/IPC samples without resetting the anchor to a late
 * sample. That keeps both player UIs moving until the next valid seek/reset.
 */
export function reconcilePlaybackClockState(
  state: PlaybackClockState,
  input: SmoothPlaybackClockOptions,
  now: number,
): PlaybackClockState {
  const authoritativeTime = clampPlaybackTime(input.time, input.duration);
  const currentTime = getClockTime(state, input.duration, now);
  const isRunning = isClockRunning(input);

  if (shouldSnapPlaybackClock(state, input, now)) {
    return {
      anchor: {
        time: authoritativeTime,
        timestamp: isRunning ? now : 0,
      },
      time: authoritativeTime,
      playbackRate: input.playbackRate,
      isRunning,
      resetKey: input.resetKey,
      authoritativeTime,
    };
  }

  if (!isRunning) {
    // A native sample may still arrive as buffering begins; accept progress,
    // but never let a delayed sample pull the frozen clock backward.
    const frozenTime = Math.max(currentTime, authoritativeTime);

    return {
      anchor: { time: frozenTime, timestamp: 0 },
      time: frozenTime,
      playbackRate: input.playbackRate,
      isRunning: false,
      resetKey: input.resetKey,
      authoritativeTime,
    };
  }

  if (!state.isRunning || state.playbackRate !== input.playbackRate) {
    return {
      anchor: { time: currentTime, timestamp: now },
      time: currentTime,
      playbackRate: input.playbackRate,
      isRunning: true,
      resetKey: input.resetKey,
      authoritativeTime,
    };
  }

  if (authoritativeTime > currentTime) {
    return {
      anchor: { time: authoritativeTime, timestamp: now },
      time: authoritativeTime,
      playbackRate: input.playbackRate,
      isRunning: true,
      resetKey: input.resetKey,
      authoritativeTime,
    };
  }

  return {
    ...state,
    anchor: {
      time: clampPlaybackTime(state.anchor.time, input.duration),
      timestamp: state.anchor.timestamp,
    },
    time: currentTime,
    playbackRate: input.playbackRate,
    isRunning: true,
    resetKey: input.resetKey,
    authoritativeTime,
  };
}

export function advancePlaybackClockState(
  state: PlaybackClockState,
  duration: number,
  now: number,
): PlaybackClockState {
  if (!state.isRunning) return state;

  return { ...state, time: getClockTime(state, duration, now) };
}

export function useSmoothPlaybackClock(
  options: SmoothPlaybackClockOptions,
): number {
  const {
    duration,
    isActive,
    isLoading,
    isSeeking,
    playbackRate,
    resetKey,
    tickIntervalMs,
    time,
  } = options;
  const input = useMemo(
    () => ({
      time,
      duration,
      playbackRate,
      isActive,
      isLoading,
      isSeeking,
      tickIntervalMs,
      resetKey,
    }),
    [
      duration,
      isActive,
      isLoading,
      isSeeking,
      playbackRate,
      resetKey,
      tickIntervalMs,
      time,
    ],
  );
  const stateRef = useRef<PlaybackClockState | null>(null);
  const [clockTime, setClockTime] = useState(() =>
    clampPlaybackTime(time, duration),
  );

  if (!stateRef.current) {
    stateRef.current = createPlaybackClockState(input, performance.now());
  }

  useEffect(() => {
    const now = performance.now();
    const previousState = stateRef.current!;
    const shouldSnap = shouldSnapPlaybackClock(previousState, input, now);
    const nextState = reconcilePlaybackClockState(previousState, input, now);
    stateRef.current = nextState;

    if (
      nextState.time !== clockTime &&
      (shouldSnap || clampPlaybackTime(time, duration) > clockTime)
    ) {
      setClockTime(nextState.time);
    }
    if (!nextState.isRunning) return;

    let animationFrame = 0;
    const tick = (frameNow: number) => {
      const next = advancePlaybackClockState(
        stateRef.current!,
        duration,
        frameNow,
      );
      stateRef.current = next;

      if (
        Math.abs(next.time - clockTime) >=
        Math.max(0, tickIntervalMs ?? VISUAL_PLAYBACK_CLOCK_TICK_MS) / 1000
      ) {
        setClockTime(next.time);
      }

      if (duration <= 0 || next.time < duration) {
        animationFrame = requestAnimationFrame(tick);
      }
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [clockTime, duration, input, tickIntervalMs, time]);

  return clockTime;
}

function getPlaybackClockResetKey(state: {
  source: { id?: string; url?: string } | null;
  sourceId: string | null;
  meta: Parameters<typeof getMediaKey>[0];
}): string {
  return `${state.sourceId ?? state.source?.id ?? state.source?.url ?? ""}:${getMediaKey(state.meta) ?? ""}`;
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
  const resetKey = usePlayerStore((s) => getPlaybackClockResetKey(s));

  const isActive =
    isPlaying &&
    !isPaused &&
    !isSeeking &&
    hasRenderedFrame &&
    status === playerStatus.PLAYING &&
    playbackRate > 0;

  return useSmoothPlaybackClock({
    time,
    duration,
    playbackRate,
    isActive,
    isLoading,
    isSeeking,
    resetKey,
  });
}
