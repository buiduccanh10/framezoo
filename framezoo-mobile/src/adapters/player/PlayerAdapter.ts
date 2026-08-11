import type { AddonStream, PlayerSnapshot, SubtitleTrack } from '@/types';

export type PlayerListener = (snapshot: PlayerSnapshot) => void;

export interface PlayerAdapter {
  getSnapshot(): PlayerSnapshot;
  subscribe(listener: PlayerListener): () => void;
  load(source: AddonStream, startAt?: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(position: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setSubtitleTrack(track: SubtitleTrack | null): Promise<void>;
  destroy(): Promise<void>;
}
