import { useCallback, useRef } from "react";

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
  const lastClickRef = useRef(0);

  const handleClick = useCallback(() => {
    const now = Date.now();
    if (now - lastClickRef.current < 350) return;
    lastClickRef.current = now;
    display?.toggleFullscreen();
  }, [display]);

  return (
    <VideoPlayerButton
      className={props.className}
      iconSizeClass={props.iconSizeClass}
      onClick={handleClick}
      icon={isFullscreen ? Icons.COMPRESS : Icons.EXPAND}
    />
  );
}
