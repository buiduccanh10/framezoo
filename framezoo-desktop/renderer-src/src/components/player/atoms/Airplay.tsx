import { Icons } from "@/components/Icon";
import { VideoPlayerButton } from "@/components/player/internals/Button";
import { isPlaybackInteractionLocked } from "@/components/player/utils/playbackLock";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { isSafari } from "@/utils/detectFeatures";

interface AirplayProps {
  iconSizeClass?: string;
  className?: string;
}

export function Airplay(props: AirplayProps) {
  const canAirplay = usePlayerStore((s) => s.interface.canAirplay);
  const display = usePlayerStore((s) => s.display);
  const source = usePlayerStore((s) => s.source);
  const status = usePlayerStore((s) => s.status);
  const mediaPlaying = usePlayerStore((s) => s.mediaPlaying);
  const subtitleSyncActive = usePlayerStore((s) => s.subtitleSync.active);

  // Check if source is supported for casting
  // HLS is always supported (proxied if needed)
  // MP4/File is only supported if it doesn't need headers (no proxy available)
  const isCastable = (() => {
    if (!source) return false;
    if (source.type === "hls") return true;
    if (source.type === "file") {
      const hasHeaders =
        Object.keys(source.headers || {}).length > 0 ||
        Object.keys(source.preferredHeaders || {}).length > 0;
      return !hasHeaders;
    }
    return true; // Unknown types assumed castable
  })();

  // Show Airplay button on Safari browsers (which support AirPlay natively)
  // or when the webkit event has confirmed availability
  if (!canAirplay && !isSafari) return null;

  return (
    <VideoPlayerButton
      className={props.className}
      iconSizeClass={props.iconSizeClass}
      onClick={() => display?.startAirplay()}
      disabled={
        status !== playerStatus.PLAYING ||
        !isCastable ||
        mediaPlaying.isLoading ||
        isPlaybackInteractionLocked(mediaPlaying, subtitleSyncActive)
      }
      icon={Icons.AIRPLAY}
    />
  );
}
