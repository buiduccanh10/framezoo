import { createContext, useContext } from "react";

import { usePlaybackClock } from "@/components/player/hooks/usePlaybackClock";

const PlaybackClockContext = createContext<number | null>(null);

export function PlaybackClockProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const clockTime = usePlaybackClock();

  return (
    <PlaybackClockContext.Provider value={clockTime}>
      {children}
    </PlaybackClockContext.Provider>
  );
}

export function useSharedPlaybackClock(): number {
  const clockTime = useContext(PlaybackClockContext);
  if (clockTime === null) {
    throw new Error(
      "useSharedPlaybackClock must be used inside PlaybackClockProvider",
    );
  }
  return clockTime;
}
