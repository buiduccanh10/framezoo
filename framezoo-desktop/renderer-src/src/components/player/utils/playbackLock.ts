interface PlaybackState {
  isLoading: boolean;
  hasRenderedFrame: boolean;
}

export function isPlaybackInteractionLocked(
  mediaPlaying: PlaybackState,
  subtitleSyncActive: boolean,
): boolean {
  return (
    mediaPlaying.isLoading ||
    !mediaPlaying.hasRenderedFrame ||
    subtitleSyncActive
  );
}
