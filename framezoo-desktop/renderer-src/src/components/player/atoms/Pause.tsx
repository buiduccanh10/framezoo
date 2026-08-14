import { Icons } from "@/components/Icon";
import { VideoPlayerButton } from "@/components/player/internals/Button";
import { isPlaybackInteractionLocked } from "@/components/player/utils/playbackLock";
import { usePlayerStore } from "@/stores/player/store";

export function Pause(props: { iconSizeClass?: string; className?: string }) {
  const display = usePlayerStore((s) => s.display);
  const { isPaused, isLoading, hasRenderedFrame } = usePlayerStore(
    (s) => s.mediaPlaying,
  );
  const isSubtitleSyncActive = usePlayerStore((s) => s.subtitleSync.active);

  const disabled = isPlaybackInteractionLocked(
    { isLoading, hasRenderedFrame },
    isSubtitleSyncActive,
  );

  const toggle = () => {
    if (disabled) return;
    if (isPaused) display?.play();
    else display?.pause();
  };

  return (
    <VideoPlayerButton
      className={props.className}
      iconSizeClass={props.iconSizeClass}
      onClick={toggle}
      disabled={disabled}
      icon={isPaused ? Icons.PLAY : Icons.PAUSE}
    />
  );
}
