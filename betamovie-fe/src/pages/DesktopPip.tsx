import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Icon, Icons } from "@/components/Icon";
import { CaptionCue } from "@/components/player/base/SubtitleView";
import { makeVideoElementDisplayInterface } from "@/components/player/display/base";
import {
  DisplayError,
  DisplayInterface,
} from "@/components/player/display/displayInterface";
import {
  captionIsVisible,
  makeQueId,
  parseCanonicalVtt,
} from "@/components/player/utils/captions";
import {
  DesktopPipAction,
  DesktopPipCaption,
  DesktopPipState,
} from "@/desktop/pip";
import { useSubtitleStore } from "@/stores/subtitles";
import { durationExceedsHour, formatSeconds } from "@/utils/formatSeconds";

type DesktopElectronApi = {
  closeDesktopPipWindow(): Promise<boolean>;
  focusMainWindow(): Promise<boolean>;
  getDesktopPipWindowState(): Promise<DesktopPipState | null>;
  sendDesktopPipAction(action: DesktopPipAction): Promise<boolean>;
  onDesktopPipState(
    listener: (state: DesktopPipState | null) => void,
  ): () => void;
};

const dragRegionStyle = { ["WebkitAppRegion" as any]: "drag" };
const noDragRegionStyle = { ["WebkitAppRegion" as any]: "no-drag" };
const CONTROL_AUTOHIDE_MS = 2200;

function getDesktopElectronApi(): DesktopElectronApi | null {
  const electronApi = (window as any).electronAPI;
  if (!electronApi) return null;
  return electronApi as DesktopElectronApi;
}

function getSourceSignature(state: DesktopPipState | null): string {
  if (!state?.source) return "";
  return JSON.stringify(state.source);
}

function clampTime(time: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return Math.max(0, time);
  }

  return Math.max(0, Math.min(time, duration));
}

function areDesktopPipCaptionsEqual(
  left: DesktopPipCaption | null,
  right: DesktopPipCaption | null,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.language === right.language && left.vttData === right.vttData;
}

function shouldReplacePipState(
  previousState: DesktopPipState | null,
  nextState: DesktopPipState | null,
) {
  if (previousState === nextState) return false;
  if (!previousState || !nextState) return true;

  return (
    getSourceSignature(previousState) !== getSourceSignature(nextState) ||
    previousState.duration !== nextState.duration ||
    previousState.paused !== nextState.paused ||
    previousState.playbackRate !== nextState.playbackRate ||
    previousState.title !== nextState.title ||
    previousState.dualSubEnabled !== nextState.dualSubEnabled ||
    !areDesktopPipCaptionsEqual(previousState.caption, nextState.caption) ||
    !areDesktopPipCaptionsEqual(
      previousState.secondaryCaption,
      nextState.secondaryCaption,
    )
  );
}

type ParsedCaptionCue = {
  start: number;
  end: number;
  content: string;
};

function getVisibleCaptionCues(
  parsedCaptions: ParsedCaptionCue[],
  delay: number,
  videoTime: number,
) {
  return parsedCaptions.filter(({ start, end }) =>
    captionIsVisible(start, end, delay, videoTime),
  );
}

function areVisibleCaptionCuesEqual(
  left: ParsedCaptionCue[],
  right: ParsedCaptionCue[],
) {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  return left.every((cue, index) => {
    const nextCue = right[index];
    return (
      cue.start === nextCue?.start &&
      cue.end === nextCue?.end &&
      cue.content === nextCue?.content
    );
  });
}

const DesktopPipCaptionTrack = memo(
  function DesktopPipCaptionTrackInner(props: {
    caption: DesktopPipCaption | null;
    display: DisplayInterface | null;
    initialTime: number;
    secondary?: boolean;
  }) {
    const styling = useSubtitleStore((s) => s.styling);
    const overrideCasing = useSubtitleStore((s) => s.overrideCasing);
    const delay = useSubtitleStore((s) => s.delay);

    const parsedCaptions = useMemo(
      () =>
        props.caption?.vttData ? parseCanonicalVtt(props.caption.vttData) : [],
      [props.caption?.vttData],
    );

    const [visibleCaptions, setVisibleCaptions] = useState<ParsedCaptionCue[]>(
      () => getVisibleCaptionCues(parsedCaptions, delay, props.initialTime),
    );

    useEffect(() => {
      const nextVisibleCaptions = getVisibleCaptionCues(
        parsedCaptions,
        delay,
        props.initialTime,
      );
      setVisibleCaptions((previousCaptions) =>
        areVisibleCaptionCuesEqual(previousCaptions, nextVisibleCaptions)
          ? previousCaptions
          : nextVisibleCaptions,
      );
    }, [delay, parsedCaptions, props.initialTime]);

    useEffect(() => {
      if (!props.display) return;

      const handleTime = (nextTime: number) => {
        const nextVisibleCaptions = getVisibleCaptionCues(
          parsedCaptions,
          delay,
          nextTime,
        );
        setVisibleCaptions((previousCaptions) =>
          areVisibleCaptionCuesEqual(previousCaptions, nextVisibleCaptions)
            ? previousCaptions
            : nextVisibleCaptions,
        );
      };

      props.display.on("time", handleTime);

      return () => {
        props.display?.off("time", handleTime);
      };
    }, [delay, parsedCaptions, props.display]);

    if (!props.caption || visibleCaptions.length === 0) return null;

    return (
      <div
        className={props.secondary ? "opacity-90" : undefined}
        style={props.secondary ? { opacity: 0.9 } : undefined}
      >
        {visibleCaptions.map(({ start, end, content }, i) => (
          <CaptionCue
            key={`${props.secondary ? "secondary-" : ""}${makeQueId(i, start, end)}`}
            text={content}
            styling={styling}
            overrideCasing={overrideCasing}
            useNativePictureInPictureStyle
          />
        ))}
      </div>
    );
  },
);

function useDisplayTime(
  display: DisplayInterface | null,
  initialTime: number,
  throttleMs = 0,
) {
  const [time, setTime] = useState(initialTime);
  const committedTimeRef = useRef(initialTime);
  const pendingTimeRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    committedTimeRef.current = initialTime;
    pendingTimeRef.current = null;
    setTime(initialTime);
  }, [initialTime]);

  useEffect(() => {
    if (!display) return;

    const clearPendingTimeout = () => {
      if (!timeoutRef.current) return;
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };

    const commitTime = (nextTime: number) => {
      committedTimeRef.current = nextTime;
      startTransition(() => {
        setTime(nextTime);
      });
    };

    const flushPendingTime = () => {
      clearPendingTimeout();
      if (pendingTimeRef.current === null) return;
      const nextTime = pendingTimeRef.current;
      pendingTimeRef.current = null;
      commitTime(nextTime);
    };

    const handleTime = (nextTime: number) => {
      if (throttleMs <= 0) {
        pendingTimeRef.current = null;
        commitTime(nextTime);
        return;
      }

      pendingTimeRef.current = nextTime;

      const currentSecond = Math.floor(committedTimeRef.current);
      const nextSecond = Math.floor(nextTime);
      if (
        nextSecond !== currentSecond ||
        Math.abs(nextTime - committedTimeRef.current) >= 0.35
      ) {
        flushPendingTime();
        return;
      }

      if (!timeoutRef.current) {
        timeoutRef.current = setTimeout(flushPendingTime, throttleMs);
      }
    };

    display.on("time", handleTime);

    return () => {
      clearPendingTimeout();
      pendingTimeRef.current = null;
      display.off("time", handleTime);
    };
  }, [display, throttleMs]);

  return time;
}

const DesktopPipProgressBar = memo(function DesktopPipProgressBarInner(props: {
  controlsVisible: boolean;
  display: DisplayInterface | null;
  duration: number;
  initialTime: number;
  isScrubbing: boolean;
  onScrubbingChange(nextScrubbing: boolean): void;
  onSeek(nextTime: number): void;
  revealControls(): void;
}) {
  const videoTime = useDisplayTime(
    props.display,
    props.initialTime,
    props.isScrubbing ? 0 : 140,
  );
  const effectiveTime = clampTime(videoTime, props.duration);
  const timeHasHours = durationExceedsHour(props.duration);
  const remainingTime = Math.max(props.duration - effectiveTime, 0);

  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-20 px-2.5 pb-2.5 transition-all duration-200 ${
        props.controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      style={noDragRegionStyle}
    >
      <div className="rounded-[18px] border border-white/14 bg-black/24 px-3 py-2.5 shadow-2xl backdrop-blur-xl">
        <div className="grid grid-cols-[auto,1fr,auto] items-center gap-2.5">
          <span className="min-w-[42px] text-right text-[11px] font-medium tabular-nums text-white/76">
            {formatSeconds(effectiveTime, timeHasHours)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(props.duration, 0)}
            step={0.1}
            value={props.duration > 0 ? effectiveTime : 0}
            onPointerDown={() => {
              props.onScrubbingChange(true);
              props.revealControls();
            }}
            onPointerUp={() => {
              props.onScrubbingChange(false);
              props.revealControls();
            }}
            onChange={(event) => {
              props.onSeek(Number(event.currentTarget.value));
            }}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/18 accent-white"
          />
          <span className="min-w-[48px] text-left text-[11px] font-medium tabular-nums text-white/76">
            {props.duration > 0
              ? `-${formatSeconds(remainingTime, timeHasHours)}`
              : "--:--"}
          </span>
        </div>
      </div>
    </div>
  );
});

function DesktopPipButton(props: {
  icon: Icons;
  label: string;
  onClick(): void;
  large?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className={`flex items-center justify-center rounded-full border border-white/20 bg-black/35 text-white transition duration-200 hover:bg-black/60 active:scale-95 ${
        props.large ? "h-16 w-16" : "h-10 w-10"
      } ${props.className ?? ""}`}
      style={noDragRegionStyle}
    >
      <Icon
        icon={props.icon}
        className={props.large ? "text-[30px]" : "text-[18px]"}
      />
    </button>
  );
}

export default function DesktopPipPage() {
  const [pipState, setPipState] = useState<DesktopPipState | null>(null);
  const [display, setDisplay] = useState<DisplayInterface | null>(null);
  const [videoElementNode, setVideoElementNode] =
    useState<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const displayRef = useRef<DisplayInterface | null>(null);
  const sourceSignatureRef = useRef("");
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoTimeRef = useRef(0);

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

  const syncStateToDisplay = useCallback(
    (nextState: DesktopPipState | null) => {
      if (!nextState?.source || !videoElementNode || !displayRef.current) {
        return;
      }

      const displayInterface = displayRef.current;
      const sourceSignature = getSourceSignature(nextState);
      const sourceChanged = sourceSignature !== sourceSignatureRef.current;

      document.title = nextState.title || "AlphaFlix PiP";

      if (sourceChanged) {
        sourceSignatureRef.current = sourceSignature;
        videoTimeRef.current = nextState.time;
        displayInterface.load({
          source: nextState.source,
          startAt: nextState.time,
          automaticQuality: false,
          preferredQuality: null,
          autoplay: !nextState.paused,
        });
      } else {
        const drift = Math.abs(
          (videoElementNode.currentTime ?? 0) - nextState.time,
        );
        if (nextState.paused || drift > 0.75) {
          displayInterface.setTime(nextState.time);
        }
      }

      displayInterface.setPlaybackRate(nextState.playbackRate || 1);
      void displayInterface.setVolume(0);

      if (nextState.paused) {
        displayInterface.pause();
      } else {
        displayInterface.play();
      }
    },
    [videoElementNode],
  );

  const updatePipState = useCallback(
    (updater: (state: DesktopPipState) => DesktopPipState) => {
      setPipState((previousState) => {
        if (!previousState) return previousState;
        return updater(previousState);
      });
    },
    [],
  );

  const sendAction = useCallback((action: DesktopPipAction) => {
    void getDesktopElectronApi()?.sendDesktopPipAction(action);
  }, []);

  const togglePlayback = useCallback(() => {
    sendAction({ type: "togglePlayback" });
    updatePipState((state) => ({
      ...state,
      paused: !state.paused,
    }));

    if (displayRef.current) {
      if (pipState?.paused) {
        displayRef.current.play();
      } else {
        displayRef.current.pause();
      }
    }
  }, [pipState?.paused, sendAction, updatePipState]);

  const seekTo = useCallback(
    (nextTime: number) => {
      const duration = pipState?.duration ?? 0;
      const clampedTime = clampTime(nextTime, duration);

      sendAction({
        type: "seekTo",
        time: clampedTime,
      });
      updatePipState((state) => ({
        ...state,
        time: clampedTime,
      }));
      videoTimeRef.current = clampedTime;
      displayRef.current?.setTime(clampedTime);
    },
    [pipState?.duration, sendAction, updatePipState],
  );

  const seekBy = useCallback(
    (delta: number) => {
      seekTo(videoTimeRef.current + delta);
    },
    [seekTo],
  );

  const returnToPlayerApp = useCallback(() => {
    const electronApi = getDesktopElectronApi();
    if (!electronApi) return;

    void Promise.allSettled([
      electronApi.focusMainWindow(),
      electronApi.closeDesktopPipWindow(),
    ]);
  }, []);

  const closeDesktopPip = useCallback(() => {
    void getDesktopElectronApi()?.closeDesktopPipWindow();
  }, []);

  useEffect(() => {
    const displayInterface = makeVideoElementDisplayInterface({
      desktopPipMirror: true,
    });
    const handleTime = (time: number) => {
      videoTimeRef.current = time;
    };
    const handleError = (nextError: DisplayError) => {
      setError(nextError.message ?? nextError.errorName);
    };

    displayRef.current = displayInterface;
    setDisplay(displayInterface);
    displayInterface.on("time", handleTime);
    displayInterface.on("error", handleError);

    return () => {
      displayInterface.off("time", handleTime);
      displayInterface.off("error", handleError);
      displayInterface.destroy();
      displayRef.current = null;
      setDisplay(null);
    };
  }, []);

  useEffect(() => {
    if (!display || !videoElementNode) return;
    display.processVideoElement(videoElementNode);
    void display.setVolume(0);
  }, [display, videoElementNode]);

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
    if (!isScrubbing) return;

    const handlePointerRelease = () => {
      setIsScrubbing(false);
      revealControls();
    };

    window.addEventListener("pointerup", handlePointerRelease);
    window.addEventListener("pointercancel", handlePointerRelease);

    return () => {
      window.removeEventListener("pointerup", handlePointerRelease);
      window.removeEventListener("pointercancel", handlePointerRelease);
    };
  }, [isScrubbing, revealControls]);

  useEffect(() => {
    const electronApi = getDesktopElectronApi();
    if (!electronApi) {
      setError("Desktop bridge unavailable");
      return;
    }

    let active = true;

    void electronApi.getDesktopPipWindowState().then((state) => {
      if (!active) return;
      videoTimeRef.current = state?.time ?? 0;
      syncStateToDisplay(state);
      setPipState(state);
    });

    const unsubscribe = electronApi.onDesktopPipState((state) => {
      setError(null);
      videoTimeRef.current = state?.time ?? videoTimeRef.current;
      syncStateToDisplay(state);
      setPipState((previousState) =>
        shouldReplacePipState(previousState, state) ? state : previousState,
      );
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [syncStateToDisplay]);

  const duration = pipState?.duration ?? 0;
  const shouldShowSecondaryCaption =
    pipState?.dualSubEnabled &&
    pipState.secondaryCaption &&
    (!pipState.caption ||
      pipState.secondaryCaption.vttData !== pipState.caption.vttData);

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-black text-white select-none"
      onPointerMove={revealControls}
      onPointerDown={revealControls}
      onPointerLeave={() => {
        if (!isScrubbing) {
          clearControlsTimeout();
          setControlsVisible(false);
        }
      }}
    >
      <video
        className="absolute inset-0 h-full w-full bg-black"
        autoPlay
        muted
        playsInline
        ref={setVideoElementNode}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "black",
          objectFit: "contain",
        }}
      />

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/70" />

      <div
        className={`absolute inset-x-0 top-0 z-20 transition-opacity duration-200 ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div
          className="flex items-start justify-between px-3 py-3"
          style={dragRegionStyle}
        >
          <div
            className="flex min-w-0 items-center gap-3"
            style={noDragRegionStyle}
          >
            <DesktopPipButton
              icon={Icons.X}
              label="Close picture in picture"
              onClick={closeDesktopPip}
            />
            <div className="min-w-0 max-w-[30vw] truncate text-sm font-medium text-white/80">
              {pipState?.title ?? "AlphaFlix"}
            </div>
          </div>

          <div style={noDragRegionStyle}>
            <DesktopPipButton
              icon={Icons.COMPRESS}
              label="Return to player app"
              onClick={returnToPlayerApp}
            />
          </div>
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center px-[8%] transition-all duration-200"
        style={{
          bottom: controlsVisible ? "3.55rem" : "1.2rem",
        }}
      >
        {shouldShowSecondaryCaption ? (
          <DesktopPipCaptionTrack
            display={display}
            caption={pipState.secondaryCaption}
            initialTime={videoTimeRef.current}
            secondary
          />
        ) : null}
        <DesktopPipCaptionTrack
          display={display}
          caption={pipState?.caption ?? null}
          initialTime={videoTimeRef.current}
        />
      </div>

      <div
        className={`absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 justify-center transition-all duration-200 ${
          controlsVisible
            ? "opacity-100"
            : "pointer-events-none translate-y-[-44%] opacity-0"
        }`}
        style={noDragRegionStyle}
      >
        <div className="flex items-center justify-center gap-5">
          <DesktopPipButton
            icon={Icons.SKIP_BACKWARD}
            label="Seek backward 10 seconds"
            onClick={() => seekBy(-10)}
            className="h-14 w-14 bg-black/20 backdrop-blur-md"
          />
          <DesktopPipButton
            icon={pipState?.paused ? Icons.PLAY : Icons.PAUSE}
            label={pipState?.paused ? "Play" : "Pause"}
            onClick={togglePlayback}
            large
            className="bg-white/18 backdrop-blur-md"
          />
          <DesktopPipButton
            icon={Icons.SKIP_FORWARD}
            label="Seek forward 10 seconds"
            onClick={() => seekBy(10)}
            className="h-14 w-14 bg-black/20 backdrop-blur-md"
          />
        </div>
      </div>

      <DesktopPipProgressBar
        controlsVisible={controlsVisible}
        display={display}
        duration={duration}
        initialTime={videoTimeRef.current}
        isScrubbing={isScrubbing}
        onScrubbingChange={setIsScrubbing}
        onSeek={seekTo}
        revealControls={revealControls}
      />

      {error ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 px-4 text-center text-xs text-white/70">
          {error}
        </div>
      ) : null}
    </div>
  );
}
