import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { makeVideoElementDisplayInterface } from "@/components/player/display/base";
import { buildVttObjectUrl } from "@/components/player/utils/captions";
import { getDocumentPictureInPictureRoots } from "@/components/player/utils/documentPictureInPicture";
import { useActiveTorrentStatus } from "@/desktop/torrentPlaybackStore";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { useSubtitleStore } from "@/stores/subtitles";
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
  const captionAsTrack = usePlayerStore((s) => s.caption.asTrack);
  const subtitleDelay = useSubtitleStore((s) => s.delay);
  const source = usePlayerStore((s) => s.source);
  const pictureInPictureMode = usePlayerStore(
    (s) => s.interface.pictureInPictureMode,
  );
  const documentPictureInPictureWindow = usePlayerStore(
    (s) => s.interface.documentPictureInPictureWindow,
  );
  const trackObjectUrl = useObjectUrl(
    () =>
      vttData
        ? buildVttObjectUrl(vttData, secondaryVttData, subtitleDelay)
        : null,
    [vttData, secondaryVttData, subtitleDelay],
  );

  const documentPictureInPictureRoots =
    pictureInPictureMode === "document"
      ? getDocumentPictureInPictureRoots(documentPictureInPictureWindow)
      : null;
  const shouldHideMainVideoForDesktopPip = pictureInPictureMode === "desktop";
  // Use native tracks only when the display explicitly requires them
  // (e.g. native fullscreen / native PiP on some platforms).
  const shouldUseNativeTrack =
    pictureInPictureMode !== "document" && captionAsTrack && source !== null;

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

  const torrentStatus = useActiveTorrentStatus();
  const mpvContainerRef = useRef<HTMLDivElement | null>(null);

  const streamUrl = torrentStatus?.streamUrl;
  const streamType = torrentStatus?.streamType;
  const directPlay = (torrentStatus as any)?.directPlay;

  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.attachMpvPlayer) return;

    if (streamUrl && (streamType === "file" || directPlay)) {
      const container = mpvContainerRef.current;
      if (!container) return;

      const updateBounds = () => {
        const currentRect = container.getBoundingClientRect();
        void electronAPI.updateMpvBounds({
          x: currentRect.left,
          y: currentRect.top,
          width: currentRect.width || window.innerWidth,
          height: currentRect.height || window.innerHeight,
        });
      };

      const rect = container.getBoundingClientRect();
      const bounds = {
        x: rect.left,
        y: rect.top,
        width: rect.width || window.innerWidth,
        height: rect.height || window.innerHeight,
      };

      void electronAPI.attachMpvPlayer(streamUrl, bounds);

      const resizeObserver = new ResizeObserver(() => {
        updateBounds();
      });

      resizeObserver.observe(container);
      window.addEventListener("resize", updateBounds);

      return () => {
        window.removeEventListener("resize", updateBounds);
        resizeObserver.disconnect();
        void electronAPI.detachMpvPlayer();
      };
    } else {
      void electronAPI.detachMpvPlayer();
    }
  }, [streamUrl, streamType, directPlay]);

  // 2-way sync between MPV IPC status and React Player
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.onMpvStatus) return;

    const unbindStatus = electronAPI.onMpvStatus(
      (status: { name: string; data: any }) => {
        const activeDisplay = usePlayerStore.getState().display as any;

        if (status.name === "time-pos" && typeof status.data === "number") {
          const time = status.data;
          activeDisplay?.emit("time", time);
          if (time > 0) {
            activeDisplay?.emit("loading", false);
            activeDisplay?.emit("play", undefined);
          }
        } else if (
          status.name === "duration" &&
          typeof status.data === "number" &&
          status.data > 0
        ) {
          activeDisplay?.emit("duration", status.data);
        } else if (
          status.name === "pause" &&
          typeof status.data === "boolean"
        ) {
          if (status.data) {
            activeDisplay?.emit("pause", undefined);
          } else {
            activeDisplay?.emit("play", undefined);
            activeDisplay?.emit("loading", false);
          }
        }
      },
    );

    return () => {
      unbindStatus();
    };
  }, []);

  // Forward user control actions (Play/Pause/Seek/Volume) from React player to MPV
  useEffect(() => {
    const vEl = videoElementNode;
    const electronAPI = (window as any).electronAPI;
    if (!vEl || !electronAPI?.sendMpvCommand) return;

    const handlePlay = () => {
      void electronAPI.sendMpvCommand("set_property", "pause", false);
    };

    const handlePause = () => {
      void electronAPI.sendMpvCommand("set_property", "pause", true);
    };

    const handleSeeking = () => {
      void electronAPI.sendMpvCommand("seek", vEl.currentTime, "absolute");
    };

    const handleVolumeChange = () => {
      void electronAPI.sendMpvCommand(
        "set_property",
        "volume",
        vEl.volume * 100,
      );
    };

    vEl.addEventListener("play", handlePlay);
    vEl.addEventListener("pause", handlePause);
    vEl.addEventListener("seeking", handleSeeking);
    vEl.addEventListener("volumechange", handleVolumeChange);

    return () => {
      vEl.removeEventListener("play", handlePlay);
      vEl.removeEventListener("pause", handlePause);
      vEl.removeEventListener("seeking", handleSeeking);
      vEl.removeEventListener("volumechange", handleVolumeChange);
    };
  }, [videoElementNode]);

  const videoElement = (
    <>
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
          opacity: shouldHideMainVideoForDesktopPip ? 0 : 1,
        }}
      >
        {subtitleTrack}
      </video>
      <div
        ref={mpvContainerRef}
        id="mpv-video-container"
        className="absolute inset-0 w-full h-full pointer-events-none"
      />
      {shouldHideMainVideoForDesktopPip ? (
        <div className="pointer-events-none absolute inset-0 bg-black" />
      ) : null}
    </>
  );

  if (documentPictureInPictureRoots?.videoRoot) {
    return createPortal(videoElement, documentPictureInPictureRoots.videoRoot);
  }

  return videoElement;
}

export function VideoContainer() {
  const show = useShouldShowVideoElement();
  const display = usePlayerStore((s) => s.display);
  const status = usePlayerStore((s) => s.status);

  useEffect(() => {
    if (status === playerStatus.PLAYING) return;

    display?.load({
      source: null,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });
  }, [display, status]);

  useDisplayInterface();
  useInitializeSource();

  if (!show) return null;
  return <VideoElement />;
}
