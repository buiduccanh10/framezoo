import { useCallback, useEffect, useRef } from "react";

import { Icon, Icons } from "@/components/Icon";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

export function AutoPlayStart() {
  const display = usePlayerStore((s) => s.display);
  const isPlaying = usePlayerStore((s) => s.mediaPlaying.isPlaying);
  const isLoading = usePlayerStore((s) => s.mediaPlaying.isLoading);
  const hasPlayedOnce = usePlayerStore((s) => s.mediaPlaying.hasPlayedOnce);
  const status = usePlayerStore((s) => s.status);
  const source = usePlayerStore((s) => s.source);
  const duration = usePlayerStore((s) => s.progress.duration);
  const time = usePlayerStore((s) => s.progress.time);
  const isSubtitleSyncActive = usePlayerStore((s) => s.subtitleSync.active);

  const attemptedPlayRef = useRef(false);

  useEffect(() => {
    if (isSubtitleSyncActive) return;

    if (status !== playerStatus.PLAYING || hasPlayedOnce || time > 0) {
      if (status !== playerStatus.PLAYING) {
        attemptedPlayRef.current = false;
      }
      return;
    }

    const isStreamReady =
      !isLoading || (Number.isFinite(duration) && duration > 0) || time > 0;

    if (display && !isPlaying && !attemptedPlayRef.current && isStreamReady) {
      attemptedPlayRef.current = true;
      display.play();
    }
  }, [
    status,
    display,
    isPlaying,
    isLoading,
    duration,
    time,
    hasPlayedOnce,
    isSubtitleSyncActive,
  ]);

  const handleClick = useCallback(() => {
    if (usePlayerStore.getState().subtitleSync.active) return;
    display?.play();
  }, [display]);

  if (isSubtitleSyncActive) return null;
  if (hasPlayedOnce || time > 0) return null;
  if (isPlaying) return null;
  if (isLoading) return null;
  if (status !== playerStatus.PLAYING) return null;
  if (
    source?.type === "file" &&
    source.isTorrent === true &&
    (!Number.isFinite(duration) || duration <= 0)
  ) {
    return null;
  }

  return (
    <div
      onClick={handleClick}
      className="group pointer-events-auto flex h-16 w-16 cursor-pointer items-center justify-center bg-video-autoPlay-background hover:bg-video-autoPlay-hover rounded-full text-white transition-[background-color,transform] hover:scale-125 active:scale-100"
    >
      <Icon
        icon={Icons.PLAY}
        className="text-2xl transition-transform group-hover:scale-125"
      />
    </div>
  );
}
