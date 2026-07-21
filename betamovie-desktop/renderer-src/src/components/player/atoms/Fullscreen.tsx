import { Icons } from "@/components/Icon";
import { VideoPlayerButton } from "@/components/player/internals/Button";
import { usePlayerStore } from "@/stores/player/store";

interface FullscreenProps {
  iconSizeClass?: string;
  className?: string;
}

export function Fullscreen(props: FullscreenProps) {
  const { isFullscreen } = usePlayerStore((s) => s.interface);
  const display = usePlayerStore((s) => s.display);

  return (
    <VideoPlayerButton
      className={props.className}
      iconSizeClass={props.iconSizeClass}
      onClick={() => display?.toggleFullscreen()}
      icon={isFullscreen ? Icons.COMPRESS : Icons.EXPAND}
    />
  );
}
