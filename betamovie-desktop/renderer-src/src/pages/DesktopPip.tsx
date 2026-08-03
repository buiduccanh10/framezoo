import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { Icon, Icons } from "@/components/Icon";
import { CaptionCue } from "@/components/player/base/SubtitleView";
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
  sendDesktopPipAction(action: DesktopPipAction): Promise<boolean>;
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
    typeof api.onDesktopPipState !== "function"
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
  const styling = {
    ...useFallbackSubtitleStyling(),
  };
  const captions = useMemo(() => {
    const primary = props.state.caption
      ? tryParseCanonicalVtt(props.state.caption.vttData)
      : [];
    const secondary = props.state.secondaryCaption
      ? tryParseCanonicalVtt(props.state.secondaryCaption.vttData)
      : [];
    return {
      primary: primary.filter((cue) =>
        captionIsVisible(
          cue.start,
          cue.end,
          props.state.secondaryDelay,
          props.state.time,
        ),
      ),
      secondary: secondary.filter((cue) =>
        captionIsVisible(
          cue.start,
          cue.end,
          props.state.primaryDelay,
          props.state.time,
        ),
      ),
    };
  }, [props.state]);

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
  const [error, setError] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [hideTimer, setHideTimer] = useState<ReturnType<
    typeof setTimeout
  > | null>(null);

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
    void getDesktopElectronApi()?.closeDesktopPipWindow();
  }, []);

  const returnToPlayer = useCallback(() => {
    const api = getDesktopElectronApi();
    if (!api) return;
    void Promise.allSettled([
      api.focusMainWindow(),
      api.closeDesktopPipWindow(),
    ]);
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
    void api
      .getDesktopPipWindowState()
      .then((state) => {
        if (active) setPipState(state);
      })
      .catch(() => setError("Unable to load PiP state"));

    const unsubscribe = api.onDesktopPipState((state) => {
      setError(null);
      setPipState(state);
    });

    return () => {
      active = false;
      unsubscribe();
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

  if (!pipState) {
    return (
      <div className="fixed inset-0 bg-black text-center text-xs text-white/60">
        {error ?? "Loading PiP"}
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
              {pipState.title || "AlphaFlix"}
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
