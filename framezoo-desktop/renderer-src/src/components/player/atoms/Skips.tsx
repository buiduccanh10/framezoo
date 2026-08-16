import { useCallback } from "react";

import { Icons } from "@/components/Icon";
import { VideoPlayerButton } from "@/components/player/internals/Button";
import { isPlaybackInteractionLocked } from "@/components/player/utils/playbackLock";
import { usePlayerStore } from "@/stores/player/store";

export function SkipForward(props: {
  iconSizeClass?: string;
  inControl: boolean;
  className?: string;
}) {
  const display = usePlayerStore((s) => s.display);
  const time = usePlayerStore((s) => s.progress.time);
  const { isLoading, hasRenderedFrame, isPaused } = usePlayerStore(
    (s) => s.mediaPlaying,
  );
  const isSubtitleSyncActive = usePlayerStore((s) => s.subtitleSync.active);
  const isPlaybackLocked = isPlaybackInteractionLocked(
    { isLoading, hasRenderedFrame, isPaused },
    isSubtitleSyncActive,
  );
  const commit = useCallback(() => {
    if (isPlaybackLocked) return;
    display?.setTime(time + 10);
  }, [display, isPlaybackLocked, time]);
  if (!props.inControl) return null;
  return (
    <VideoPlayerButton
      className={props.className}
      iconSizeClass={props.iconSizeClass}
      onClick={commit}
      disabled={isPlaybackLocked}
      icon={Icons.SKIP_FORWARD}
    />
  );
}

export function SkipBackward(props: {
  iconSizeClass?: string;
  inControl: boolean;
  className?: string;
}) {
  const display = usePlayerStore((s) => s.display);
  const time = usePlayerStore((s) => s.progress.time);
  const { isLoading, hasRenderedFrame, isPaused } = usePlayerStore(
    (s) => s.mediaPlaying,
  );
  const isSubtitleSyncActive = usePlayerStore((s) => s.subtitleSync.active);
  const isPlaybackLocked = isPlaybackInteractionLocked(
    { isLoading, hasRenderedFrame, isPaused },
    isSubtitleSyncActive,
  );
  const commit = useCallback(() => {
    if (isPlaybackLocked) return;
    display?.setTime(time - 10);
  }, [display, isPlaybackLocked, time]);
  if (!props.inControl) return null;
  return (
    <VideoPlayerButton
      className={props.className}
      iconSizeClass={props.iconSizeClass}
      onClick={commit}
      disabled={isPlaybackLocked}
      icon={Icons.SKIP_BACKWARD}
    />
  );
}
