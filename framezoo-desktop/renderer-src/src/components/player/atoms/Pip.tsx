import { Icons } from "@/components/Icon";
import { VideoPlayerButton } from "@/components/player/internals/Button";
import { isPlaybackInteractionLocked } from "@/components/player/utils/playbackLock";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import {
  canDocumentPictureInPicture,
  canPictureInPicture,
  canWebkitPictureInPicture,
  isDesktopAppRuntime,
} from "@/utils/detectFeatures";

export function Pip(props: { iconSizeClass?: string; className?: string }) {
  const display = usePlayerStore((s) => s.display);
  const status = usePlayerStore((s) => s.status);
  const source = usePlayerStore((s) => s.source);
  const mediaPlaying = usePlayerStore((s) => s.mediaPlaying);
  const subtitleSyncActive = usePlayerStore((s) => s.subtitleSync.active);

  const canUseDesktopPip = isDesktopAppRuntime();

  if (
    !canUseDesktopPip &&
    !canDocumentPictureInPicture() &&
    !canPictureInPicture() &&
    !canWebkitPictureInPicture()
  ) {
    return null;
  }

  const disabled =
    status !== playerStatus.PLAYING ||
    !source ||
    mediaPlaying.isLoading ||
    isPlaybackInteractionLocked(mediaPlaying, subtitleSyncActive);

  return (
    <VideoPlayerButton
      className={props.className}
      iconSizeClass={props.iconSizeClass}
      onClick={() => display?.togglePictureInPicture()}
      disabled={disabled}
      icon={Icons.PICTURE_IN_PICTURE}
    />
  );
}
