import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Icon, Icons } from "@/components/Icon";
import { getDocumentPictureInPictureRoots } from "@/components/player/utils/documentPictureInPicture";
import { isPlaybackInteractionLocked } from "@/components/player/utils/playbackLock";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { durationExceedsHour, formatSeconds } from "@/utils/formatSeconds";

const CONTROL_AUTOHIDE_MS = 2200;

function clampTime(time: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return Math.max(0, time);
  }

  return Math.max(0, Math.min(time, duration));
}

function DocumentPipButton(props: {
  icon: Icons;
  label: string;
  onClick(): void;
  disabled?: boolean;
  large?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`flex items-center justify-center rounded-full border border-white/20 bg-black/35 text-white transition duration-200 hover:bg-black/60 active:scale-95 ${
        props.large ? "h-16 w-16" : "h-10 w-10"
      } ${props.disabled ? "cursor-not-allowed opacity-50" : ""} ${
        props.className ?? ""
      }`}
    >
      <Icon
        icon={props.icon}
        className={props.large ? "text-[30px]" : "text-[18px]"}
      />
    </button>
  );
}

export function DocumentPipOverlay() {
  const status = usePlayerStore((s) => s.status);
  const display = usePlayerStore((s) => s.display);
  const meta = usePlayerStore((s) => s.meta);
  const time = usePlayerStore((s) => s.progress.time);
  const duration = usePlayerStore((s) => s.progress.duration);
  const isPaused = usePlayerStore((s) => s.mediaPlaying.isPaused);
  const isSubtitleSyncActive = usePlayerStore((s) => s.subtitleSync.active);
  const mediaPlaying = usePlayerStore((s) => s.mediaPlaying);
  const isPlaybackLocked = isPlaybackInteractionLocked(
    mediaPlaying,
    isSubtitleSyncActive,
  );
  const pictureInPictureMode = usePlayerStore(
    (s) => s.interface.pictureInPictureMode,
  );
  const documentPictureInPictureWindow = usePlayerStore(
    (s) => s.interface.documentPictureInPictureWindow,
  );
  const setSeeking = usePlayerStore((s) => s.setSeeking);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const documentPictureInPictureRoots =
    pictureInPictureMode === "document"
      ? getDocumentPictureInPictureRoots(documentPictureInPictureWindow)
      : null;

  const clearControlsTimeout = useCallback(() => {
    if (!controlsTimeoutRef.current) return;
    clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = null;
  }, []);

  const scheduleControlsHide = useCallback(() => {
    clearControlsTimeout();
    if (isScrubbing) return;

    controlsTimeoutRef.current = setTimeout(() => {
      setControlsVisible(false);
      controlsTimeoutRef.current = null;
    }, CONTROL_AUTOHIDE_MS);
  }, [clearControlsTimeout, isScrubbing]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleControlsHide();
  }, [scheduleControlsHide]);

  const effectiveTime = clampTime(time, duration);
  const timeHasHours = durationExceedsHour(duration);
  const remainingTime = Math.max(duration - effectiveTime, 0);
  const title = meta?.episode?.title || meta?.title || "Framezoo";

  const seekTo = useCallback(
    (nextTime: number) => {
      if (isPlaybackLocked) return;
      display?.setTime(clampTime(nextTime, duration));
    },
    [display, duration, isPlaybackLocked],
  );

  const seekBy = useCallback(
    (delta: number) => {
      seekTo(effectiveTime + delta);
    },
    [effectiveTime, seekTo],
  );

  const togglePlayback = useCallback(() => {
    if (!display || isPlaybackLocked) return;
    if (isPaused) {
      display.play();
    } else {
      display.pause();
    }
  }, [display, isPaused, isPlaybackLocked]);

  useEffect(() => {
    if (!isPlaybackLocked || !isScrubbing) return;
    setIsScrubbing(false);
    setSeeking(false);
  }, [isPlaybackLocked, isScrubbing, setSeeking]);

  useEffect(() => {
    scheduleControlsHide();
    return () => {
      clearControlsTimeout();
    };
  }, [clearControlsTimeout, scheduleControlsHide]);

  useEffect(() => {
    if (isScrubbing) {
      clearControlsTimeout();
      setControlsVisible(true);
      return;
    }

    scheduleControlsHide();
  }, [clearControlsTimeout, isScrubbing, scheduleControlsHide]);

  useEffect(() => {
    const root = documentPictureInPictureRoots?.root;
    if (!root) return;

    root.style.setProperty(
      "--framezoo-document-pip-subtitle-bottom",
      controlsVisible ? "3.55rem" : "1.15rem",
    );
    root.style.setProperty(
      "--framezoo-pip-subtitle-background",
      "rgba(0,0,0,0.68)",
    );
    root.style.setProperty("--framezoo-pip-subtitle-font-weight", "600");
    root.style.setProperty(
      "--framezoo-pip-subtitle-text-shadow",
      "0 2px 5px rgba(0,0,0,0.96)",
    );

    return () => {
      root.style.removeProperty("--framezoo-document-pip-subtitle-bottom");
      root.style.removeProperty("--framezoo-pip-subtitle-background");
      root.style.removeProperty("--framezoo-pip-subtitle-font-weight");
      root.style.removeProperty("--framezoo-pip-subtitle-text-shadow");
    };
  }, [controlsVisible, documentPictureInPictureRoots?.root]);

  if (
    pictureInPictureMode !== "document" ||
    !documentPictureInPictureRoots?.overlayRoot ||
    !display ||
    status !== playerStatus.PLAYING
  ) {
    return null;
  }

  return createPortal(
    <div
      className="absolute inset-0 z-20 overflow-hidden bg-transparent text-white select-none"
      onPointerMove={revealControls}
      onPointerDown={revealControls}
      onPointerLeave={() => {
        if (!isScrubbing) {
          clearControlsTimeout();
          setControlsVisible(false);
        }
      }}
      onDoubleClick={togglePlayback}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/70" />

      <div
        className={`absolute inset-x-0 top-0 z-20 transition-opacity duration-200 ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="px-4 py-3">
          <div className="min-w-0 max-w-[40vw] truncate text-sm font-medium text-white/82">
            {title}
          </div>
        </div>
      </div>

      <div
        className={`absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 justify-center transition-all duration-200 ${
          controlsVisible
            ? "opacity-100"
            : "pointer-events-none translate-y-[-44%] opacity-0"
        }`}
      >
        <div className="flex items-center justify-center gap-5">
          <DocumentPipButton
            icon={Icons.SKIP_BACKWARD}
            label="Seek backward 10 seconds"
            onClick={() => seekBy(-10)}
            disabled={isPlaybackLocked}
            className="h-14 w-14 bg-black/20 backdrop-blur-md"
          />
          <DocumentPipButton
            icon={isPaused ? Icons.PLAY : Icons.PAUSE}
            label={isPaused ? "Play" : "Pause"}
            onClick={togglePlayback}
            disabled={isPlaybackLocked}
            large
            className="bg-white/18 backdrop-blur-md"
          />
          <DocumentPipButton
            icon={Icons.SKIP_FORWARD}
            label="Seek forward 10 seconds"
            onClick={() => seekBy(10)}
            disabled={isPlaybackLocked}
            className="h-14 w-14 bg-black/20 backdrop-blur-md"
          />
        </div>
      </div>

      <div
        className={`absolute inset-x-0 bottom-0 z-20 px-2.5 pb-2.5 transition-all duration-200 ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="rounded-[18px] border border-white/14 bg-black/24 px-3 py-2.5 shadow-2xl backdrop-blur-xl">
          <div className="grid grid-cols-[auto,1fr,auto] items-center gap-2.5">
            <span className="min-w-[42px] text-right text-[11px] font-medium tabular-nums text-white/76">
              {formatSeconds(effectiveTime, timeHasHours)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(duration, 0)}
              step={0.1}
              value={duration > 0 ? effectiveTime : 0}
              disabled={isPlaybackLocked}
              onPointerDown={() => {
                if (isPlaybackLocked) return;
                setIsScrubbing(true);
                setSeeking(true);
                revealControls();
              }}
              onPointerUp={() => {
                setIsScrubbing(false);
                setSeeking(false);
                revealControls();
              }}
              onPointerCancel={() => {
                setIsScrubbing(false);
                setSeeking(false);
              }}
              onChange={(event) => {
                if (isPlaybackLocked) return;
                seekTo(Number(event.currentTarget.value));
              }}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/18 accent-white"
            />
            <span className="min-w-[48px] text-left text-[11px] font-medium tabular-nums text-white/76">
              {duration > 0
                ? `-${formatSeconds(remainingTime, timeHasHours)}`
                : "--:--"}
            </span>
          </div>
        </div>
      </div>
    </div>,
    documentPictureInPictureRoots.overlayRoot,
  );
}
