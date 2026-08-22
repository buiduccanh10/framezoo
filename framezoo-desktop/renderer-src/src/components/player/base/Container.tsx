import { ReactNode, RefObject, useEffect, useRef } from "react";

import { OverlayDisplay } from "@/components/overlays/OverlayDisplay";
import { AutoSkipSegments } from "@/components/player/internals/AutoSkipSegments";
import { CastingInternal } from "@/components/player/internals/CastingInternal";
import { HeadUpdater } from "@/components/player/internals/HeadUpdater";
import { KeyboardEvents } from "@/components/player/internals/KeyboardEvents";
import { MediaSession } from "@/components/player/internals/MediaSession";
import { MetaReporter } from "@/components/player/internals/MetaReporter";
import { MobileLandscapeLock } from "@/components/player/internals/MobileLandscapeLock";
import { ProgressSaver } from "@/components/player/internals/ProgressSaver";
import { VideoClickTarget } from "@/components/player/internals/VideoClickTarget";
import { VideoContainer } from "@/components/player/internals/VideoContainer";
import { WatchPartyResetter } from "@/components/player/internals/WatchPartyResetter";
import { PlayerHoverState } from "@/stores/player/slices/interface";
import { usePlayerStore } from "@/stores/player/store";

import { WatchPartyReporter } from "../internals/Backend/WatchPartyReporter";

export interface PlayerProps {
  children?: ReactNode;
  showingControls: boolean;
  onLoad?: () => void;
}

function useHovering(containerEl: RefObject<HTMLDivElement>) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateInterfaceHovering = usePlayerStore(
    (s) => s.updateInterfaceHovering,
  );

  useEffect(() => {
    function resetHover() {
      if (
        usePlayerStore.getState().interface.hovering !==
        PlayerHoverState.MOUSE_HOVER
      ) {
        updateInterfaceHovering(PlayerHoverState.MOUSE_HOVER);
      }
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        if (usePlayerStore.getState().interface.isHoveringControls) {
          resetHover();
          return;
        }
        updateInterfaceHovering(PlayerHoverState.NOT_HOVERING);
        timeoutRef.current = null;
      }, 3000);
    }

    function pointerMove() {
      resetHover();
    }

    function pointerLeave(e: MouseEvent) {
      if (!e.relatedTarget && !document.hasFocus()) {
        updateInterfaceHovering(PlayerHoverState.NOT_HOVERING);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      }
    }

    const el = containerEl.current;
    if (el) {
      el.addEventListener("pointermove", pointerMove, { passive: true });
      el.addEventListener("mousemove", pointerMove, { passive: true });
      el.addEventListener("pointerenter", pointerMove, { passive: true });
      el.addEventListener("mouseenter", pointerMove, { passive: true });
    }

    window.addEventListener("pointermove", pointerMove, { passive: true });
    window.addEventListener("mousemove", pointerMove, { passive: true });
    document.addEventListener("mouseleave", pointerLeave, { passive: true });
    window.addEventListener("focus", resetHover);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (el) {
        el.removeEventListener("pointermove", pointerMove);
        el.removeEventListener("mousemove", pointerMove);
        el.removeEventListener("pointerenter", pointerMove);
        el.removeEventListener("mouseenter", pointerMove);
      }
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("mousemove", pointerMove);
      document.removeEventListener("mouseleave", pointerLeave);
      window.removeEventListener("focus", resetHover);
    };
  }, [containerEl, updateInterfaceHovering]);
}

function BaseContainer(props: { children?: ReactNode }) {
  const containerEl = useRef<HTMLDivElement | null>(null);
  const display = usePlayerStore((s) => s.display);
  useHovering(containerEl);

  // report container element to display interface
  useEffect(() => {
    if (display && containerEl.current) {
      display.processContainerElement(containerEl.current);
    }
  }, [display, containerEl]);

  return (
    <div ref={containerEl} className="w-full h-full">
      <OverlayDisplay>
        <div className="h-screen select-none">{props.children}</div>
      </OverlayDisplay>
    </div>
  );
}

export function Container(props: PlayerProps) {
  const propRef = useRef(props.onLoad);
  const status = usePlayerStore((s) => s.status);
  useEffect(() => {
    propRef.current?.();
  }, []);

  useEffect(() => {
    const electronApi = (
      window as Window & {
        electronAPI?: { createLibMpvPlayer?: unknown };
      }
    ).electronAPI;
    if (typeof electronApi?.createLibMpvPlayer !== "function") return;

    const root = document.documentElement;
    if (status === "playing") {
      root.dataset.libmpvPlayer = "true";
    } else {
      delete root.dataset.libmpvPlayer;
    }

    return () => {
      delete root.dataset.libmpvPlayer;
    };
  }, [status]);

  return (
    <div className="relative">
      <BaseContainer>
        <MetaReporter />
        <CastingInternal />
        <VideoContainer />
        <ProgressSaver />
        <KeyboardEvents />
        <MediaSession />
        <WatchPartyReporter />
        <WatchPartyResetter />
        <AutoSkipSegments />
        <div className="relative h-screen overflow-hidden">
          <VideoClickTarget showingControls={props.showingControls} />
          <HeadUpdater />
          {props.children}
          <MobileLandscapeLock />
        </div>
      </BaseContainer>
    </div>
  );
}
