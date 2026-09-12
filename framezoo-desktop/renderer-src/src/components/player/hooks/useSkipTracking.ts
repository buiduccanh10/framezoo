import { useCallback, useEffect, useRef, useState } from "react";

import { usePlayerStore } from "@/stores/player/store";

interface SkipEvent {
  startTime: number;
  endTime: number;
  skipDuration: number;
  timestamp: number;
  confidence: number; // 0.0-1.0 confidence score
  meta?: {
    title: string;
    type: string;
    tmdbId?: string;
    seasonNumber?: number;
    episodeNumber?: number;
  };
}

interface SkipTrackingResult {
  /** Array of skip events detected */
  skipHistory: SkipEvent[];
  /** The most recent skip event */
  latestSkip: SkipEvent | null;
  /** Clear the skip history */
  clearHistory: () => void;
  /** Add a manual skip event (e.g., from skip intro button) */
  addSkipEvent: (event: Omit<SkipEvent, "timestamp">) => void;
}

/**
 * Hook that tracks manual skip events and monitors user behavior patterns for confidence adjustment.
 * Only processes skip events added via addSkipEvent (e.g., from skip intro button).
 *
 * @param minSkipThreshold Minimum total forward movement in 5-second window to start session (default: 20)
 * @param maxHistory Maximum number of skip events to keep in history (default: 50)
 */
export function useSkipTracking(
  minSkipThreshold: number = 20,
  maxHistory: number = 50,
): SkipTrackingResult {
  const [skipHistory, setSkipHistory] = useState<SkipEvent[]>([]);
  const clearHistory = useCallback(() => {
    setSkipHistory([]);
  }, []);

  const addSkipEvent = useCallback(
    (event: Omit<SkipEvent, "timestamp">) => {
      const skipEvent: SkipEvent = {
        ...event,
        timestamp: Date.now(),
      };

      setSkipHistory((prev) => {
        const newHistory = [...prev, skipEvent];
        return newHistory.length > maxHistory
          ? newHistory.slice(newHistory.length - maxHistory)
          : newHistory;
      });
    },
    [maxHistory],
  );

  const meta = usePlayerStore((s) => s.meta);

  // Reset tracking when content changes
  useEffect(() => {
    clearHistory();
  }, [meta?.tmdbId, clearHistory]);

  return {
    skipHistory,
    latestSkip: skipHistory[skipHistory.length - 1] || null,
    clearHistory,
    addSkipEvent,
  };
}
