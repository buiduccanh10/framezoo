import { Icons } from "@/components/Icon";
import { VideoPlayerButton } from "@/components/player/internals/Button";
import { usePlayerStore } from "@/stores/player/store";

interface WidescreenProps {
  iconSizeClass?: string;
  className?: string;
}

export function Widescreen(props: WidescreenProps) {
  const dimensions = usePlayerStore((s) => s.interface.videoDimensions);

  return (
    <VideoPlayerButton
      className={
        props.className ? `${props.className} text-white` : "text-white"
      }
      iconSizeClass={props.iconSizeClass}
      icon={Icons.STRETCH}
      onClick={() => {
        if (!dimensions) return;
        const api = (window as any).electronAPI;
        if (api?.resizeToVideo) {
          api.resizeToVideo(dimensions.width, dimensions.height);
        }
      }}
    />
  );
}

