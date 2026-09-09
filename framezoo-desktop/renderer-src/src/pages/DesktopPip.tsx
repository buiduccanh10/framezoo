import type { PointerEvent as ReactPointerEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon, Icons } from "@/components/Icon";
import { Loading } from "@/components/layout/Loading";
import {
  PlayerLoadingOverlayView,
  getPlayerLoadingOverlayState,
} from "@/components/player/atoms/PlayerLoadingOverlay";
import { CaptionCue } from "@/components/player/base/SubtitleView";
import { useSmoothPlaybackClock } from "@/components/player/hooks/usePlaybackClock";
import {
  captionIsVisible,
  tryParseCanonicalVtt,
} from "@/components/player/utils/captions";
import { getNextEpisodeVisibility } from "@/components/player/utils/controlVisibility";
import { isPlaybackInteractionLocked } from "@/components/player/utils/playbackLock";
import {
  DesktopPipAction,
  DesktopPipState,
  setPersistedDesktopPipWindowSize,
} from "@/desktop/pip";
import { playerStatus } from "@/stores/player/slices/source";
import { durationExceedsHour, formatSeconds } from "@/utils/formatSeconds";

type DesktopElectronApi = {
  closeDesktopPipWindow(): Promise<boolean>;
  focusMainWindow(): Promise<boolean>;
  getDesktopPipWindowState(): Promise<DesktopPipState | null>;
  moveDesktopPipWindow(x: number, y: number): void;
  onDesktopPipActivate(listener: () => void): () => void;
  sendDesktopPipAction(action: DesktopPipAction): Promise<boolean>;
  snapDesktopPipWindow(): Promise<boolean>;
  signalDesktopPipReady(): Promise<boolean>;
  onDesktopPipState(
    listener: (state: DesktopPipState | null) => void,
  ): () => void;
};

const noDragRegionStyle = { ["WebkitAppRegion" as any]: "no-drag" };
const CONTROL_AUTOHIDE_MS = 2200;

type PipDragState = {
  pointerId: number;
  pointerX: number;
  pointerY: number;
  windowX: number;
  windowY: number;
};

function formatSpeed(bytesPerSecond: number) {
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

function getDesktopElectronApi(): DesktopElectronApi | null {
  const api = (window as any).electronAPI;
  if (
    !api ||
    typeof api.getDesktopPipWindowState !== "function" ||
    typeof api.onDesktopPipState !== "function" ||
    typeof api.signalDesktopPipReady !== "function" ||
    typeof api.onDesktopPipActivate !== "function" ||
    typeof api.moveDesktopPipWindow !== "function" ||
    typeof api.snapDesktopPipWindow !== "function"
  ) {
    return null;
  }
  return api as DesktopElectronApi;
}

function DesktopPipButton(props: {
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
      className={`flex items-center justify-center rounded-full border border-white/20 bg-black/35 text-white transition duration-200 ${
        props.disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:bg-black/60 active:scale-95"
      } ${props.large ? "h-16 w-16" : "h-10 w-10"} ${props.className ?? ""}`}
      style={noDragRegionStyle}
    >
      <Icon
        icon={props.icon}
        className={props.large ? "text-[30px]" : "text-[18px]"}
      />
    </button>
  );
}

const PipCaptions = memo(function PipCaptionsView(props: {
  state: DesktopPipState;
  controlsVisible: boolean;
}) {
  const time = useSmoothPlaybackClock({
    time: props.state.time,
    duration: props.state.duration,
    playbackRate: props.state.playbackRate,
    isActive: !props.state.paused && props.state.playbackRate > 0,
  });
  const styling = {
    ...useFallbackSubtitleStyling(),
  };
  const primaryVttData = props.state.caption?.vttData;
  const secondaryVttData = props.state.secondaryCaption?.vttData;
  const primary = useMemo(
    () => (primaryVttData ? tryParseCanonicalVtt(primaryVttData) : []),
    [primaryVttData],
  );
  const secondary = useMemo(
    () => (secondaryVttData ? tryParseCanonicalVtt(secondaryVttData) : []),
    [secondaryVttData],
  );
  const captions = useMemo(() => {
    return {
      primary: primary.filter((cue) =>
        captionIsVisible(cue.start, cue.end, props.state.primaryDelay, time),
      ),
      secondary: secondary.filter((cue) =>
        captionIsVisible(cue.start, cue.end, props.state.secondaryDelay, time),
      ),
    };
  }, [
    primary,
    props.state.primaryDelay,
    props.state.secondaryDelay,
    secondary,
    time,
  ]);

  const showSecondary =
    props.state.dualSubEnabled &&
    props.state.secondaryCaption &&
    props.state.secondaryCaption.vttData !== props.state.caption?.vttData;

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center px-[8%] transition-all duration-300 ${
        props.controlsVisible ? "bottom-14" : "bottom-5"
      }`}
    >
      {showSecondary
        ? captions.secondary.map((cue, index) => (
            <CaptionCue
              key={`secondary-${cue.start}-${cue.end}-${index}`}
              text={cue.content}
              styling={styling}
              overrideCasing={false}
              useNativePictureInPictureStyle
            />
          ))
        : null}
      {captions.primary.map((cue, index) => (
        <CaptionCue
          key={`primary-${cue.start}-${cue.end}-${index}`}
          text={cue.content}
          styling={styling}
          overrideCasing={false}
          useNativePictureInPictureStyle
        />
      ))}
    </div>
  );
});

function useFallbackSubtitleStyling() {
  return {
    fontSize: 1,
    color: "#ffffff",
    backgroundColor: "rgba(0,0,0,0.45)",
  } as any;
}

function PipProgress(props: {
  state: DesktopPipState;
  visible: boolean;
  disabled: boolean;
  onSeek(time: number): void;
  onHoverChange(hovering: boolean): void;
  onScrubChange(scrubbing: boolean): void;
}) {
  const hours = durationExceedsHour(props.state.duration);
  const current = Math.max(
    0,
    Math.min(
      props.state.time,
      props.state.duration || Number.POSITIVE_INFINITY,
    ),
  );
  const remaining = Math.max(props.state.duration - current, 0);

  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-20 px-2.5 pb-2.5 transition-opacity ${
        props.visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      style={noDragRegionStyle}
      data-pip-no-drag
      onPointerEnter={() => props.onHoverChange(true)}
      onPointerLeave={() => props.onHoverChange(false)}
      onPointerDown={() => {
        if (!props.disabled) props.onScrubChange(true);
      }}
      onPointerUp={() => props.onScrubChange(false)}
      onPointerCancel={() => props.onScrubChange(false)}
    >
      <div className="bg-transparent py-2.5 shadow-2xl backdrop-blur-xl">
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5">
          <span className="min-w-[42px] text-right text-[11px] font-medium tabular-nums text-white/76">
            {formatSeconds(current, hours)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(props.state.duration, 0)}
            step={0.1}
            value={props.state.duration > 0 ? current : 0}
            disabled={props.disabled}
            onChange={(event) =>
              props.onSeek(Number(event.currentTarget.value))
            }
            className={`h-1 w-full appearance-none rounded-full bg-white/18 accent-white ${
              props.disabled
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer"
            }`}
          />
          <span className="min-w-[48px] text-left text-[11px] font-medium tabular-nums text-white/76">
            {props.state.duration > 0
              ? `-${formatSeconds(remaining, hours)}`
              : "--:--"}
          </span>
        </div>
      </div>
    </div>
  );
}

function PipTextActionButton(props: {
  icon: Icons;
  label: string;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`flex h-9 items-center gap-1.5 rounded-md border border-white/20 bg-black/55 px-3 text-xs font-semibold text-white shadow-lg backdrop-blur-md transition ${
        props.disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:bg-black/75 active:scale-95"
      }`}
      style={noDragRegionStyle}
    >
      <Icon icon={props.icon} className="text-base" />
      <span>{props.label}</span>
    </button>
  );
}

export default function DesktopPipPage() {
  const { t } = useTranslation();
  const [pipState, setPipState] = useState<DesktopPipState | null>(null);
  const [pipReady, setPipReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsHoveringRef = useRef(false);
  const scrubbingRef = useRef(false);
  const readySignalled = useRef(false);
  const transitionInProgress = useRef(false);
  const pipDragRef = useRef<PipDragState | null>(null);

  const beginPipDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || event.target !== event.currentTarget) {
        return;
      }

      const api = getDesktopElectronApi();
      if (!api) return;

      pipDragRef.current = {
        pointerId: event.pointerId,
        pointerX: event.screenX,
        pointerY: event.screenY,
        windowX: window.screenX,
        windowY: window.screenY,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        pipDragRef.current = null;
        return;
      }
      event.preventDefault();
    },
    [],
  );

  const movePipDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = pipDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const api = getDesktopElectronApi();
      if (!api) return;

      api.moveDesktopPipWindow(
        Math.round(drag.windowX + event.screenX - drag.pointerX),
        Math.round(drag.windowY + event.screenY - drag.pointerY),
      );
      event.preventDefault();
    },
    [],
  );

  const endPipDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = pipDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    pipDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const api = getDesktopElectronApi();
    if (!api) return;

    api.moveDesktopPipWindow(
      Math.round(drag.windowX + event.screenX - drag.pointerX),
      Math.round(drag.windowY + event.screenY - drag.pointerY),
    );
    void api.snapDesktopPipWindow();
  }, []);

  const clearHideTimer = useCallback(() => {
    if (!hideTimerRef.current) return;
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const scheduleHideControls = useCallback(() => {
    clearHideTimer();
    if (controlsHoveringRef.current || scrubbingRef.current) return;

    hideTimerRef.current = setTimeout(() => {
      if (!controlsHoveringRef.current && !scrubbingRef.current) {
        setControlsVisible(false);
      }
      hideTimerRef.current = null;
    }, CONTROL_AUTOHIDE_MS);
  }, [clearHideTimer]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHideControls();
  }, [scheduleHideControls]);

  const setControlsHovering = useCallback(
    (hovering: boolean) => {
      controlsHoveringRef.current = hovering;
      if (hovering) {
        clearHideTimer();
        setControlsVisible(true);
      } else {
        scheduleHideControls();
      }
    },
    [clearHideTimer, scheduleHideControls],
  );

  const setPipScrubbing = useCallback(
    (value: boolean) => {
      scrubbingRef.current = value;
      if (value) {
        clearHideTimer();
        setControlsVisible(true);
      } else {
        scheduleHideControls();
      }
    },
    [clearHideTimer, scheduleHideControls],
  );

  const sendAction = useCallback(
    (action: DesktopPipAction) => {
      const state = pipState;
      const playbackLocked =
        !state ||
        state.playbackTarget !== "pip" ||
        !state.canControl ||
        isPlaybackInteractionLocked(state, false);
      if (action.type !== "close" && playbackLocked) return;

      void getDesktopElectronApi()?.sendDesktopPipAction(action);
    },
    [pipState],
  );

  const seekTo = useCallback(
    (time: number) => {
      if (
        !pipState ||
        pipState.playbackTarget !== "pip" ||
        !pipState.canControl ||
        isPlaybackInteractionLocked(pipState, false)
      ) {
        return;
      }
      const nextTime = Math.max(
        0,
        Math.min(time, pipState.duration || Number.POSITIVE_INFINITY),
      );
      sendAction({ type: "seekTo", time: nextTime });
      setPipState((state) => (state ? { ...state, time: nextTime } : state));
    },
    [pipState, sendAction],
  );

  const playbackControlsDisabled =
    !pipState ||
    pipState.playbackTarget !== "pip" ||
    !pipState.canControl ||
    isPlaybackInteractionLocked(pipState, false);

  const close = useCallback(() => {
    sendAction({ type: "close" });
  }, [sendAction]);

  const returnToPlayer = useCallback(() => {
    sendAction({ type: "close" });
  }, [sendAction]);

  useEffect(() => {
    document.documentElement.dataset.desktopPip = "true";
    return () => {
      delete document.documentElement.dataset.desktopPip;
    };
  }, []);

  useEffect(() => {
    const api = getDesktopElectronApi();
    if (!api) {
      setError("Desktop bridge unavailable");
      return;
    }

    let active = true;
    const publishState = (state: DesktopPipState | null) => {
      if (!active) return;
      setPipState(state);
      if (!state || readySignalled.current) return;

      readySignalled.current = true;
      void api
        .signalDesktopPipReady()
        .then((ready) => {
          if (active && !ready) {
            readySignalled.current = false;
            setError("Unable to initialize PiP");
          }
        })
        .catch(() => {
          if (active) {
            readySignalled.current = false;
            setError("Unable to initialize PiP");
          }
        });
    };

    void api
      .getDesktopPipWindowState()
      .then((state) => {
        publishState(state);
      })
      .catch(() => setError("Unable to load PiP state"));

    const unsubscribe = api.onDesktopPipState((state) => {
      setError(null);
      publishState(state);
    });
    const unsubscribeActivate = api.onDesktopPipActivate(() => {
      if (active) setPipReady(true);
    });

    return () => {
      active = false;
      unsubscribe();
      unsubscribeActivate();
    };
  }, []);

  useEffect(() => {
    return () => {
      clearHideTimer();
    };
  }, [clearHideTimer]);

  useEffect(() => {
    scheduleHideControls();
  }, [scheduleHideControls]);

  useEffect(() => {
    const persist = () => {
      setPersistedDesktopPipWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    const onResize = () => persist();
    persist();
    window.addEventListener("resize", onResize);
    window.addEventListener("beforeunload", persist);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("beforeunload", persist);
    };
  }, []);

  const loadingState = pipState
    ? getPlayerLoadingOverlayState({
        status: pipState.status,
        sourceLoading: pipState.sourceLoading,
        isLoading: pipState.isLoading,
        hasRenderedFrame: pipState.hasRenderedFrame,
        duration: pipState.duration,
        buffered: pipState.buffered,
        torrentStatus: pipState.torrent,
        isDesktopPipPlayback: true,
      })
    : null;

  const skipSegmentLabel = pipState?.skipSegment
    ? {
        intro: t("player.skipTime.intro", "Skip intro"),
        recap: t("player.skipTime.recap", "Skip recap"),
        credits: t("player.skipTime.credits", "Skip credits"),
        preview: t("player.skipTime.preview", "Skip preview"),
      }[pipState.skipSegment.type]
    : null;
  const nextEpisodeLabel = pipState?.nextEpisodeIsSeasonChange
    ? t("player.nextEpisode.nextSeason", "Next season")
    : t("player.nextEpisode.next", "Next episode");
  const skipVisibility =
    pipState?.canControl &&
    pipState.skipSegment &&
    !pipState.skipSegment.isEndingAtVideoEnd
      ? pipState.skipSegment.visibility
      : "none";
  const endingSegmentActive =
    Boolean(pipState?.skipSegment?.isEndingAtVideoEnd) &&
    Boolean(
      pipState &&
      pipState.time >= (pipState.skipSegment?.startTime ?? Infinity),
    );
  const nextVisibility =
    pipState?.status === playerStatus.PLAYING &&
    pipState.canControl &&
    pipState.nextEpisode &&
    !pipState.hideNextEpisodeButton &&
    pipState.duration > 0
      ? endingSegmentActive
        ? "always"
        : getNextEpisodeVisibility(pipState.time, pipState.duration)
      : "none";
  const showSkipAction =
    skipVisibility === "always" ||
    (skipVisibility === "hover" && controlsVisible);
  const showNextAction =
    nextVisibility === "always" ||
    (nextVisibility === "hover" && controlsVisible);

  if (!pipState || !pipReady) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black text-xs text-white/60">
        <div className="flex items-center gap-2">
          <Loading />
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 select-none overflow-hidden bg-transparent text-white"
      style={noDragRegionStyle}
      onPointerMoveCapture={revealControls}
      onPointerDownCapture={revealControls}
      onPointerLeave={scheduleHideControls}
    >
      <div
        id="libmpv-pip-surface"
        className="pointer-events-none absolute inset-0 h-full w-full bg-transparent"
        aria-hidden="true"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 z-[1] cursor-grab bg-transparent"
        style={{ ...noDragRegionStyle, touchAction: "none" }}
        onPointerDown={beginPipDrag}
        onPointerMove={movePipDrag}
        onPointerUp={endPipDrag}
        onPointerCancel={endPipDrag}
        onLostPointerCapture={endPipDrag}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/70" />
      <PlayerLoadingOverlayView
        show={
          pipState.playbackTarget === "main" ||
          Boolean(loadingState?.showOverlay)
        }
        progress={
          pipState.playbackTarget === "main"
            ? 100
            : (loadingState?.loadingProgress ?? 0)
        }
        title={pipState.title || "Framezoo"}
        logo={pipState.logo ?? undefined}
        backdrop={pipState.backdrop ?? undefined}
        showBackdrop={pipState.playbackTarget !== "main"}
        message={
          pipState.playbackTarget === "main"
            ? t(
                "player.pictureInPicture.playingInMainWindow",
                "Playing in main window",
              )
            : undefined
        }
        className="z-10"
      />
      <div
        className={`absolute inset-x-0 top-0 z-20 transition-opacity ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onPointerEnter={() => setControlsHovering(true)}
        onPointerLeave={() => setControlsHovering(false)}
      >
        <div
          className="flex items-start justify-between px-3 py-3"
          style={noDragRegionStyle}
        >
          <div
            className="flex min-w-0 items-start gap-3"
            style={noDragRegionStyle}
          >
            <DesktopPipButton
              icon={Icons.X}
              label="Close picture in picture"
              onClick={close}
            />
            <div className="flex min-w-0 max-w-[30vw] flex-col">
              <div className="truncate text-sm font-medium text-white/80">
                {pipState.title || ""}
              </div>
              {pipState.episode ? (
                <div className="truncate text-[11px] text-white/55">
                  S{pipState.episode.season ?? 0}E{pipState.episode.episode}{" "}
                  {pipState.episode.title}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3" style={noDragRegionStyle}>
            {pipState.torrent ? (
              <div className="flex items-center gap-2 text-[10px] text-white/65">
                <span>
                  {Math.round(Math.max(0, pipState.torrent.progress))}%
                </span>
                <span aria-hidden="true">•</span>
                <span className="tabular-nums">
                  {formatSpeed(pipState.torrent.speedBytesPerSecond)}
                </span>
              </div>
            ) : null}
            <DesktopPipButton
              icon={Icons.COMPRESS}
              label="Return to player app"
              onClick={returnToPlayer}
            />
          </div>
        </div>
      </div>
      <PipCaptions state={pipState} controlsVisible={controlsVisible} />
      <div
        className={`absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 justify-center transition-opacity ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={noDragRegionStyle}
        data-pip-no-drag
        onPointerEnter={() => setControlsHovering(true)}
        onPointerLeave={() => setControlsHovering(false)}
      >
        <div className="flex items-center justify-center gap-5">
          <DesktopPipButton
            icon={Icons.SKIP_BACKWARD}
            label="Seek backward 10 seconds"
            onClick={() => sendAction({ type: "seekBy", delta: -10 })}
            disabled={playbackControlsDisabled}
            className="h-14 w-14 bg-black/20 backdrop-blur-md"
          />
          <DesktopPipButton
            icon={pipState.paused ? Icons.PLAY : Icons.PAUSE}
            label={pipState.paused ? "Play" : "Pause"}
            onClick={() => sendAction({ type: "togglePlayback" })}
            disabled={playbackControlsDisabled}
            large
            className="bg-white/18 backdrop-blur-md"
          />
          <DesktopPipButton
            icon={Icons.SKIP_FORWARD}
            label="Seek forward 10 seconds"
            onClick={() => sendAction({ type: "seekBy", delta: 10 })}
            disabled={playbackControlsDisabled}
            className="h-14 w-14 bg-black/20 backdrop-blur-md"
          />
        </div>
      </div>
      {pipState.playbackTarget === "pip" &&
      (showSkipAction || showNextAction) ? (
        <div
          className="absolute inset-x-0 bottom-16 z-20 flex justify-end gap-2 px-3"
          style={noDragRegionStyle}
          data-pip-no-drag
          onPointerEnter={() => setControlsHovering(true)}
          onPointerLeave={() => setControlsHovering(false)}
        >
          {showSkipAction && skipSegmentLabel && pipState.skipSegment ? (
            <PipTextActionButton
              icon={Icons.SKIP_EPISODE}
              label={skipSegmentLabel}
              onClick={() =>
                sendAction({
                  type: "skipSegment",
                  time: pipState.skipSegment!.endTime,
                })
              }
              disabled={playbackControlsDisabled}
            />
          ) : null}
          {showNextAction && pipState.nextEpisode ? (
            <PipTextActionButton
              icon={Icons.SKIP_EPISODE}
              label={nextEpisodeLabel}
              onClick={() => sendAction({ type: "nextEpisode" })}
              disabled={playbackControlsDisabled}
            />
          ) : null}
        </div>
      ) : null}
      <PipProgress
        state={pipState}
        visible={controlsVisible}
        disabled={playbackControlsDisabled}
        onHoverChange={setControlsHovering}
        onScrubChange={setPipScrubbing}
        onSeek={seekTo}
      />
      {error ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 px-4 text-center text-xs text-white/70">
          {error}
        </div>
      ) : null}
    </div>
  );
}
