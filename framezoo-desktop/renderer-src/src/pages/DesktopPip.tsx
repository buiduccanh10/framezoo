import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon, Icons } from "@/components/Icon";
import { Loading } from "@/components/layout/Loading";
import { CaptionCue } from "@/components/player/base/SubtitleView";
import { useSmoothPlaybackClock } from "@/components/player/hooks/usePlaybackClock";
import {
  captionIsVisible,
  tryParseCanonicalVtt,
} from "@/components/player/utils/captions";
import {
  DesktopPipAction,
  DesktopPipState,
  setPersistedDesktopPipWindowSize,
} from "@/desktop/pip";
import { durationExceedsHour, formatSeconds } from "@/utils/formatSeconds";

type DesktopElectronApi = {
  closeDesktopPipWindow(): Promise<boolean>;
  focusMainWindow(): Promise<boolean>;
  getDesktopPipWindowState(): Promise<DesktopPipState | null>;
  onDesktopPipActivate(listener: () => void): () => void;
  sendDesktopPipAction(action: DesktopPipAction): Promise<boolean>;
  signalDesktopPipReady(): Promise<boolean>;
  onDesktopPipState(
    listener: (state: DesktopPipState | null) => void,
  ): () => void;
};

const dragRegionStyle = { ["WebkitAppRegion" as any]: "drag" };
const noDragRegionStyle = { ["WebkitAppRegion" as any]: "no-drag" };
const CONTROL_AUTOHIDE_MS = 2200;

function getDesktopElectronApi(): DesktopElectronApi | null {
  const api = (window as any).electronAPI;
  if (
    !api ||
    typeof api.getDesktopPipWindowState !== "function" ||
    typeof api.onDesktopPipState !== "function" ||
    typeof api.signalDesktopPipReady !== "function" ||
    typeof api.onDesktopPipActivate !== "function"
  ) {
    return null;
  }
  return api as DesktopElectronApi;
}

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
  onSeek(time: number): void;
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
    >
      <div className="bg-transparent py-2.5 shadow-2xl backdrop-blur-xl">
        <div className="grid grid-cols-[auto,1fr,auto] items-center gap-2.5">
          <span className="min-w-[42px] text-right text-[11px] font-medium tabular-nums text-white/76">
            {formatSeconds(current, hours)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(props.state.duration, 0)}
            step={0.1}
            value={props.state.duration > 0 ? current : 0}
            onChange={(event) =>
              props.onSeek(Number(event.currentTarget.value))
            }
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/18 accent-white"
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

export default function DesktopPipPage() {
  const [pipState, setPipState] = useState<DesktopPipState | null>(null);
  const [pipReady, setPipReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [hideTimer, setHideTimer] = useState<ReturnType<
    typeof setTimeout
  > | null>(null);
  const readySignalled = useRef(false);
  const transitionInProgress = useRef(false);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer) clearTimeout(hideTimer);
    setHideTimer(
      setTimeout(() => {
        setControlsVisible(false);
        setHideTimer(null);
      }, CONTROL_AUTOHIDE_MS),
    );
  }, [hideTimer]);

  const sendAction = useCallback((action: DesktopPipAction) => {
    void getDesktopElectronApi()?.sendDesktopPipAction(action);
  }, []);

  const seekTo = useCallback(
    (time: number) => {
      if (!pipState) return;
      const nextTime = Math.max(
        0,
        Math.min(time, pipState.duration || Number.POSITIVE_INFINITY),
      );
      sendAction({ type: "seekTo", time: nextTime });
      setPipState((state) => (state ? { ...state, time: nextTime } : state));
    },
    [pipState, sendAction],
  );

  const close = useCallback(() => {
    const api = getDesktopElectronApi();
    if (!api || transitionInProgress.current) return;
    transitionInProgress.current = true;
    void api
      .closeDesktopPipWindow()
      .then(() => api.focusMainWindow())
      .finally(() => {
        transitionInProgress.current = false;
      });
  }, []);

  const returnToPlayer = useCallback(() => {
    const api = getDesktopElectronApi();
    if (!api || transitionInProgress.current) return;
    transitionInProgress.current = true;
    void api
      .closeDesktopPipWindow()
      .then(() => api.focusMainWindow())
      .finally(() => {
        transitionInProgress.current = false;
      });
  }, []);

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
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [hideTimer]);

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

  if (!pipState || !pipReady) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black text-xs text-white/60">
        <div className="flex items-center gap-2">
          <Loading />
          <span>{error ?? "Loading PiP"}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 select-none overflow-hidden bg-transparent text-white"
      onPointerMove={revealControls}
      onPointerDown={revealControls}
      onPointerLeave={() => {
        if (!scrubbing) {
          if (hideTimer) clearTimeout(hideTimer);
          setControlsVisible(false);
        }
      }}
    >
      <div
        id="libmpv-pip-surface"
        className="pointer-events-none absolute inset-0 h-full w-full bg-transparent"
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/70" />
      <div
        className={`absolute inset-x-0 top-0 z-20 transition-opacity ${
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
              onClick={close}
            />
            <div className="min-w-0 max-w-[30vw] truncate text-sm font-medium text-white/80">
              {pipState.title || "Framezoo"}
            </div>
          </div>
          <div style={noDragRegionStyle}>
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
      >
        <div className="flex items-center justify-center gap-5">
          <DesktopPipButton
            icon={Icons.SKIP_BACKWARD}
            label="Seek backward 10 seconds"
            onClick={() => sendAction({ type: "seekBy", delta: -10 })}
            className="h-14 w-14 bg-black/20 backdrop-blur-md"
          />
          <DesktopPipButton
            icon={pipState.paused ? Icons.PLAY : Icons.PAUSE}
            label={pipState.paused ? "Play" : "Pause"}
            onClick={() => sendAction({ type: "togglePlayback" })}
            large
            className="bg-white/18 backdrop-blur-md"
          />
          <DesktopPipButton
            icon={Icons.SKIP_FORWARD}
            label="Seek forward 10 seconds"
            onClick={() => sendAction({ type: "seekBy", delta: 10 })}
            className="h-14 w-14 bg-black/20 backdrop-blur-md"
          />
        </div>
      </div>
      <PipProgress
        state={pipState}
        visible={controlsVisible}
        onSeek={(time) => {
          setScrubbing(true);
          seekTo(time);
          setScrubbing(false);
        }}
      />
      {error ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 px-4 text-center text-xs text-white/70">
          {error}
        </div>
      ) : null}
    </div>
  );
}
