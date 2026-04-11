import { ReactNode, useEffect, useRef, useState } from "react";

import { makeVideoElementDisplayInterface } from "@/components/player/display/base";
import { convertSubtitlesToObjectUrl } from "@/components/player/utils/captions";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";

import { useInitializeSource } from "../hooks/useInitializePlayer";

// initialize display interface
function useDisplayInterface() {
  const display = usePlayerStore((s) => s.display);
  const setDisplay = usePlayerStore((s) => s.setDisplay);

  const displayRef = useRef(display);
  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    if (!displayRef.current) {
      const newDisplay = makeVideoElementDisplayInterface();
      displayRef.current = newDisplay;
      setDisplay(newDisplay);
    }
    return () => {
      if (displayRef.current) {
        displayRef.current = null;
        setDisplay(null);
      }
    };
  }, [setDisplay]);
}

export function useShouldShowVideoElement() {
  const status = usePlayerStore((s) => s.status);

  if (status !== playerStatus.PLAYING) return false;
  return true;
}

function useObjectUrl(cb: () => string | null, deps: any[]) {
  const [output, setOutput] = useState<string | null>(null);

  useEffect(() => {
    const nextUrl = cb();
    setOutput((previousUrl) => {
      if (previousUrl && previousUrl !== nextUrl) {
        URL.revokeObjectURL(previousUrl);
      }
      return nextUrl;
    });

    return () => {
      if (nextUrl) {
        URL.revokeObjectURL(nextUrl);
      }
    };
    // deps are passed in, cb is known not to be changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return output;
}

function VideoElement() {
  const videoEl = useRef<HTMLVideoElement>(null);
  const trackEl = useRef<HTMLTrackElement>(null);
  const display = usePlayerStore((s) => s.display);
  const srtData = usePlayerStore((s) => s.caption.selected?.srtData);
  const language = usePlayerStore((s) => s.caption.selected?.language);
  const secondarySrtData = usePlayerStore((s) => s.caption.secondary?.srtData);
  const source = usePlayerStore((s) => s.source);
  const enableNativeSubtitles = usePreferencesStore(
    (s) => s.enableNativeSubtitles,
  );
  const trackObjectUrl = useObjectUrl(
    () =>
      srtData ? convertSubtitlesToObjectUrl(srtData, secondarySrtData) : null,
    [srtData, secondarySrtData],
  );

  const asTrack = usePlayerStore((s) => s.caption.asTrack);
  // Use native tracks when the setting is enabled or when requested (e.g. mobile fullscreen)
  const shouldUseNativeTrack =
    (enableNativeSubtitles || asTrack) && source !== null;

  // report video element to display interface
  useEffect(() => {
    if (display && videoEl.current) {
      display.processVideoElement(videoEl.current);
    }
  }, [display, videoEl]);

  // Control track visibility based on setting
  useEffect(() => {
    const track = trackEl.current;
    if (!track) return;

    const setMode = () => {
      track.track.mode = shouldUseNativeTrack ? "showing" : "hidden";
    };

    setMode();
    track.addEventListener("load", setMode);
    return () => {
      track.removeEventListener("load", setMode);
    };
  }, [shouldUseNativeTrack, trackObjectUrl]);

  // Attach track when native subtitles are enabled
  // SubtitleView handles showing custom captions when native subtitles is disabled
  let subtitleTrack: ReactNode = null;
  if (trackObjectUrl) {
    subtitleTrack = (
      <track
        ref={trackEl}
        label="AlphaFlix Captions"
        kind="subtitles"
        srcLang={language || "en"}
        src={trackObjectUrl}
        default
      />
    );
  }

  return (
    <video
      id="video-element"
      className="absolute inset-0 w-full h-screen bg-black"
      autoPlay
      playsInline
      ref={videoEl}
      preload="metadata"
      onContextMenu={(e) => e.preventDefault()}
    >
      {subtitleTrack}
    </video>
  );
}

export function VideoContainer() {
  const show = useShouldShowVideoElement();
  useDisplayInterface();
  useInitializeSource();

  if (!show) return null;
  return <VideoElement />;
}
