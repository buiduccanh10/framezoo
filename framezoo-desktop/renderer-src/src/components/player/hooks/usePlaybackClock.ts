import { useEffect, useRef, useState } from "react";

import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

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
  const [clockTime, setClockTime] = useState(time);
  const anchorRef = useRef({ time, timestamp: 0 });

  useEffect(() => {
    const timestamp = performance.now();
    anchorRef.current = { time, timestamp };
    setClockTime(time);

    if (
      !isPlaying ||
      isPaused ||
      isLoading ||
      isSeeking ||
      !hasRenderedFrame ||
      status !== playerStatus.PLAYING ||
      playbackRate <= 0
    ) {
      return;
    }

    let animationFrame = 0;
    const tick = (now: number) => {
      const elapsed = Math.max(0, now - anchorRef.current.timestamp) / 1000;
      const nextTime = Math.max(
        0,
        Math.min(
          duration > 0 ? duration : Number.POSITIVE_INFINITY,
          anchorRef.current.time + elapsed * playbackRate,
        ),
      );

      setClockTime(nextTime);
      if (duration <= 0 || nextTime < duration) {
        animationFrame = requestAnimationFrame(tick);
      }
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [
    duration,
    hasRenderedFrame,
    isLoading,
    isPaused,
    isPlaying,
    isSeeking,
    playbackRate,
    status,
    time,
  ]);

  return clockTime;
}
