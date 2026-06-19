import { Icons } from "@/components/Icon";
import { VideoPlayerButton } from "@/components/player/internals/Button";
import { usePlayerStore } from "@/stores/player/store";
import {
  canDocumentPictureInPicture,
  canPictureInPicture,
  canWebkitPictureInPicture,
} from "@/utils/detectFeatures";

export function Pip(props: { iconSizeClass?: string; className?: string }) {
  const display = usePlayerStore((s) => s.display);

  if (
    !canDocumentPictureInPicture() &&
    !canPictureInPicture() &&
    !canWebkitPictureInPicture()
  ) {
    return null;
  }

  return (
    <VideoPlayerButton
      className={props.className}
      iconSizeClass={props.iconSizeClass}
      onClick={() => display?.togglePictureInPicture()}
      icon={Icons.PICTURE_IN_PICTURE}
    />
  );
}
