import type { AddonStream, SubtitleTrack } from './media';

export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export interface PlayerSnapshot {
  status: PlayerStatus;
  source: AddonStream | null;
  duration: number;
  position: number;
  volume: number;
  muted: boolean;
  subtitleTracks: SubtitleTrack[];
  activeSubtitleId: string | null;
  error: string | null;
}
