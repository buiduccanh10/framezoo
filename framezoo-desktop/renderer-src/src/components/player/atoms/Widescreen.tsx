import { useState } from "react";

import { Icons } from "@/components/Icon";
import { VideoPlayerButton } from "@/components/player/internals/Button";

interface WidescreenProps {
  iconSizeClass?: string;
  className?: string;
}

export function Widescreen(props: WidescreenProps) {
  // Add widescreen status
  const [isWideScreen, setIsWideScreen] = useState(false);

  return (
    <VideoPlayerButton
      className={
        props.className ? `${props.className} text-white` : "text-white"
      }
      iconSizeClass={props.iconSizeClass}
      icon={isWideScreen ? Icons.SHRINK : Icons.STRETCH}
      onClick={() => {
        const surface = document.getElementById("libmpv-video-surface");
        if (surface) {
          surface.classList.toggle("object-cover");
          setIsWideScreen(!isWideScreen);
        }
      }}
    />
  );
}
