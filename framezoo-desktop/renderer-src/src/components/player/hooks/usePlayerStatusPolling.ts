import { useCallback, useEffect, useRef, useState } from "react";

import { usePlayerStore } from "@/stores/player/store";

interface PlayerStatusData {
  isPlaying: boolean;
  isPaused: boolean;
  isLoading: boolean;
  hasPlayedOnce: boolean;
  volume: number;
  playbackRate: number;
  time: number;
  duration: number;
  buffered: number;
  timestamp: number; // When this data point was captured
}

interface PlayerStatusPollingResult {
  /** Array of player status data points collected when state changes */
  statusHistory: PlayerStatusData[];
  /** The most recent player status data point */
  latestStatus: PlayerStatusData | null;
  /** Clear the status history */
  clearHistory: () => void;
  /** Force an immediate update of the status */
  forceUpdate: () => void;
}

/**
 * Hook that polls player status and progress, but only records changes
 * when there are meaningful differences in the player state
 *
 * @param maxHistory Maximum number of history entries to keep (default: 10)
 */
export function usePlayerStatusPolling(
  maxHistory: number = 10,
): PlayerStatusPollingResult {
  const [statusHistory, setStatusHistory] = useState<PlayerStatusData[]>([]);
  const previousStateRef = useRef<PlayerStatusData | null>(null);
  const lastUpdateTimeRef = useRef<number>(0);

  // Get the current playing state and progress
  const mediaPlaying = usePlayerStore((s) => s.mediaPlaying);
  const progress = usePlayerStore((s) => s.progress);

  // Use refs to avoid recreating the callback/interval on every store update
  const dataRef = useRef({ mediaPlaying, progress });
  dataRef.current = { mediaPlaying, progress };

  // Create a function to update the history
  const updateHistory = useCallback(() => {
    const { mediaPlaying: currentMediaPlaying, progress: currentProgress } =
      dataRef.current;
    const now = Date.now();
    const currentStatus: PlayerStatusData = {
      isPlaying: currentMediaPlaying.isPlaying,
      isPaused: currentMediaPlaying.isPaused,
      isLoading: currentMediaPlaying.isLoading,
      hasPlayedOnce: currentMediaPlaying.hasPlayedOnce,
      volume: currentMediaPlaying.volume,
      playbackRate: currentMediaPlaying.playbackRate,
      time: currentProgress.time,
      duration: currentProgress.duration,
      buffered: currentProgress.buffered,
      timestamp: now,
    };

    // Check if this is the first record
    const isFirstRecord = previousStateRef.current === null;
    if (isFirstRecord) {
      setStatusHistory([currentStatus]);
      previousStateRef.current = currentStatus;
      lastUpdateTimeRef.current = now;
      return currentStatus;
    }

    // At this point we've confirmed previousStateRef.current is not null
    const prevState = previousStateRef.current!; // Non-null assertion
    const timeSinceLastUpdate = now - lastUpdateTimeRef.current;

    // Determine if we should record this update
    const hasPlaybackStateChanged =
      prevState.isPlaying !== currentStatus.isPlaying ||
      prevState.isPaused !== currentStatus.isPaused ||
      prevState.isLoading !== currentStatus.isLoading;

    const hasPlaybackRateChanged =
      prevState.playbackRate !== currentStatus.playbackRate;

    const hasTimeChangedDuringPlayback =
      currentStatus.isPlaying &&
      timeSinceLastUpdate >= 4000 &&
      Math.abs(prevState.time - currentStatus.time) > 1;

    const hasDurationChanged =
      Math.abs(prevState.duration - currentStatus.duration) > 1;

    const periodicUpdateDuringPlayback =
      currentStatus.isPlaying && timeSinceLastUpdate >= 10000;

    // Update if any significant changes detected
    const shouldUpdate =
      hasPlaybackStateChanged ||
      hasPlaybackRateChanged ||
      hasTimeChangedDuringPlayback ||
      hasDurationChanged ||
      periodicUpdateDuringPlayback;

    if (shouldUpdate) {
      setStatusHistory((prev) => {
        const newHistory = [...prev, currentStatus];
        return newHistory.length > maxHistory
          ? newHistory.slice(newHistory.length - maxHistory)
          : newHistory;
      });

      previousStateRef.current = currentStatus;
      lastUpdateTimeRef.current = now;
    }

    return currentStatus;
  }, [maxHistory]);

  const clearHistory = useCallback(() => {
    setStatusHistory([]);
    previousStateRef.current = null;
    lastUpdateTimeRef.current = 0;
  }, []);

  useEffect(() => {
    // Initial update
    updateHistory();

    // Set up polling interval at 2 seconds
    const interval = setInterval(() => {
      if (dataRef.current.mediaPlaying.hasPlayedOnce) {
        updateHistory();
      }
    }, 2000);

    // Clean up on unmount
    return () => clearInterval(interval);
  }, [updateHistory]);

  return {
    statusHistory,
    latestStatus:
      statusHistory.length > 0 ? statusHistory[statusHistory.length - 1] : null,
    clearHistory,
    forceUpdate: updateHistory,
  };
}
