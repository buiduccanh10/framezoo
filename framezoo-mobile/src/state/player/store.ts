import { create } from 'zustand';

import type { PlayerSnapshot } from '@/types';

interface PlayerState extends PlayerSnapshot {
  setSnapshot: (snapshot: PlayerSnapshot) => void;
  reset: () => void;
}

const initialSnapshot: PlayerSnapshot = {
  status: 'idle',
  source: null,
  duration: 0,
  position: 0,
  volume: 1,
  muted: false,
  subtitleTracks: [],
  activeSubtitleId: null,
  error: null,
};

export const usePlayerStore = create<PlayerState>((set) => ({
  ...initialSnapshot,
  setSnapshot: (snapshot) => set(snapshot),
  reset: () => set(initialSnapshot),
}));
