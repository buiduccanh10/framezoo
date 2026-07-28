import { useEffect, useRef } from "react";

import { makeLibMpvDisplayInterface } from "@/components/player/display/libmpv";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

import { useInitializeSource } from "../hooks/useInitializePlayer";

function useDisplayInterface() {
  const display = usePlayerStore((state) => state.display);
  const setDisplay = usePlayerStore((state) => state.setDisplay);
  const displayRef = useRef(display);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    if (!displayRef.current) {
      const nextDisplay = makeLibMpvDisplayInterface();
      displayRef.current = nextDisplay;
      setDisplay(nextDisplay);
    }

    return () => {
      if (!displayRef.current) return;
      displayRef.current = null;
      setDisplay(null);
    };
  }, [setDisplay]);
}

export function useShouldShowVideoElement() {
  return usePlayerStore((state) => state.status === playerStatus.PLAYING);
}

function LibMpvSurface() {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const display = usePlayerStore((state) => state.display);

  useEffect(() => {
    display?.processSurfaceElement?.(surfaceRef.current);
    return () => {
      display?.processSurfaceElement?.(null);
    };
  }, [display]);

  return (
    <div
      ref={surfaceRef}
      id="libmpv-video-surface"
      className="pointer-events-none absolute inset-0 h-full w-full bg-transparent"
      aria-hidden="true"
    />
  );
}

export function VideoContainer() {
  const show = useShouldShowVideoElement();
  const display = usePlayerStore((state) => state.display);
  const status = usePlayerStore((state) => state.status);

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
  return <LibMpvSurface />;
}
