interface PlaybackState {
  isLoading: boolean;
  hasRenderedFrame: boolean;
  isPaused?: boolean;
}

export function isPlaybackInteractionLocked(
  mediaPlaying: PlaybackState,
  subtitleSyncActive: boolean,
): boolean {
  if (subtitleSyncActive) return true;
  if (!mediaPlaying.hasRenderedFrame) return true;
  if (mediaPlaying.isPaused) return false;
  return mediaPlaying.isLoading;
}
