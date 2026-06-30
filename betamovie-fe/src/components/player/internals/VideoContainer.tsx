import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { makeVideoElementDisplayInterface } from "@/components/player/display/base";
import { buildVttObjectUrl } from "@/components/player/utils/captions";
import { getDocumentPictureInPictureRoots } from "@/components/player/utils/documentPictureInPicture";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { isSafari } from "@/utils/detectFeatures";

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
  const preloadMode: "auto" | "metadata" = isSafari ? "auto" : "metadata";
  const inactiveTrackMode: TextTrackMode = isSafari ? "disabled" : "hidden";

  const videoEl = useRef<HTMLVideoElement | null>(null);
  const [videoElementNode, setVideoElementNode] =
    useState<HTMLVideoElement | null>(null);
  const trackEl = useRef<HTMLTrackElement>(null);
  const display = usePlayerStore((s) => s.display);
  const vttData = usePlayerStore((s) => s.caption.selected?.vttData);
  const language = usePlayerStore((s) => s.caption.selected?.language);
  const secondaryVttData = usePlayerStore((s) =>
    s.caption.dualSubEnabled ? s.caption.secondary?.vttData : undefined,
  );
  const source = usePlayerStore((s) => s.source);
  const pictureInPictureMode = usePlayerStore(
    (s) => s.interface.pictureInPictureMode,
  );
  const documentPictureInPictureWindow = usePlayerStore(
    (s) => s.interface.documentPictureInPictureWindow,
  );
  const trackObjectUrl = useObjectUrl(
    () => (vttData ? buildVttObjectUrl(vttData, secondaryVttData) : null),
    [vttData, secondaryVttData],
  );

  const documentPictureInPictureRoots =
    pictureInPictureMode === "document"
      ? getDocumentPictureInPictureRoots(documentPictureInPictureWindow)
      : null;
  // Use native tracks automatically for non-document PiP
  const shouldUseNativeTrack =
    pictureInPictureMode !== "document" && source !== null;

  const handleVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoEl.current = node;
    setVideoElementNode(node);
  }, []);

  // report video element to display interface
  useEffect(() => {
    if (display && videoElementNode) {
      display.processVideoElement(videoElementNode);
    }
  }, [display, videoElementNode]);

  // Control track visibility based on setting
  useEffect(() => {
    const video = videoEl.current;
    const track = trackEl.current;
    if (!video) return;
    let rafId: number | null = null;

    const setMode = () => {
      const textTracks = video.textTracks;
      for (let i = 0; i < textTracks.length; i++) {
        if (
          textTracks[i].kind === "subtitles" ||
          textTracks[i].kind === "captions"
        ) {
          textTracks[i].mode = shouldUseNativeTrack
            ? "showing"
            : inactiveTrackMode;
        }
      }

      if (track && track.track) {
        track.track.mode = shouldUseNativeTrack ? "showing" : inactiveTrackMode;
      }
    };

    setMode();
    if (trackObjectUrl && shouldUseNativeTrack) {
      rafId = requestAnimationFrame(() => {
        setMode();
      });
    }
    track?.addEventListener("load", setMode);
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      track?.removeEventListener("load", setMode);
      const textTracks = video.textTracks;
      for (let i = 0; i < textTracks.length; i++) {
        if (
          textTracks[i].kind === "subtitles" ||
          textTracks[i].kind === "captions"
        ) {
          textTracks[i].mode = "disabled";
        }
      }
    };
  }, [inactiveTrackMode, shouldUseNativeTrack, trackObjectUrl]);

  // Attach track when native subtitles are enabled
  // SubtitleView handles showing custom captions when native subtitles is disabled
  let subtitleTrack: ReactNode = null;
  if (trackObjectUrl) {
    subtitleTrack = (
      <track
        key={trackObjectUrl}
        ref={trackEl}
        label="AlphaFlix Captions"
        kind="subtitles"
        srcLang={language || "en"}
        src={trackObjectUrl}
        default={shouldUseNativeTrack}
      />
    );
  }

  const videoElement = (
    <video
      id="video-element"
      className="absolute inset-0 w-full h-screen bg-black"
      autoPlay
      playsInline
      ref={handleVideoRef}
      preload={preloadMode}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        backgroundColor: "black",
        objectFit: "contain",
      }}
    >
      {subtitleTrack}
    </video>
  );

  if (documentPictureInPictureRoots?.videoRoot) {
    return createPortal(videoElement, documentPictureInPictureRoots.videoRoot);
  }

  return videoElement;
}

export function VideoContainer() {
  const show = useShouldShowVideoElement();
  useDisplayInterface();
  useInitializeSource();

  if (!show) return null;
  return <VideoElement />;
}
