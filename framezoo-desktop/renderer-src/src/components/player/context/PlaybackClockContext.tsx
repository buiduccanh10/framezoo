import { createContext, useContext } from "react";

import { usePlaybackClock } from "@/components/player/hooks/usePlaybackClock";

const PlaybackClockContext = createContext<number>(0);

export function PlaybackClockProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Compute the shared clock time using the rAF loop in usePlaybackClock
  const clockTime = usePlaybackClock();

  return (
    <PlaybackClockContext.Provider value={clockTime}>
      {children}
    </PlaybackClockContext.Provider>
  );
}

export function useSharedPlaybackClock(): number {
  return useContext(PlaybackClockContext);
}
