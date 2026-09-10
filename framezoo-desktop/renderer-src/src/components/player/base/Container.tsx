import { ReactNode, RefObject, useEffect, useRef } from "react";
import { Subscription, fromEvent, merge, timer } from "rxjs";
import { switchMap, tap } from "rxjs/operators";

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
  const updateInterfaceHovering = usePlayerStore(
    (s) => s.updateInterfaceHovering,
  );

  useEffect(() => {
    const el = containerEl.current;
    if (!el) return;

    // Stream of events that should trigger a hover state
    const moveEvents$ = merge(
      fromEvent(el, "pointermove", { passive: true }),
      fromEvent(el, "mousemove", { passive: true }),
      fromEvent(el, "pointerenter", { passive: true }),
      fromEvent(el, "mouseenter", { passive: true }),
      fromEvent(window, "pointermove", { passive: true }),
      fromEvent(window, "mousemove", { passive: true }),
      fromEvent(window, "focus"),
    );

    // Stream of events that should immediately hide controls
    const leaveEvents$ = fromEvent<MouseEvent>(document, "mouseleave", {
      passive: true,
    });

    const subscription = new Subscription();

    // Handle hovering logic using switchMap to automatically clear previous timers
    subscription.add(
      moveEvents$
        .pipe(
          tap(() => {
            if (
              usePlayerStore.getState().interface.hovering !==
              PlayerHoverState.MOUSE_HOVER
            ) {
              updateInterfaceHovering(PlayerHoverState.MOUSE_HOVER);
            }
          }),
          switchMap(() => timer(3000)),
        )
        .subscribe(() => {
          if (usePlayerStore.getState().interface.isHoveringControls) {
            // If hovering over controls, pretend we just moved the mouse to restart the timer
            // by dispatching a fake event
            window.dispatchEvent(new Event("pointermove"));
            return;
          }
          updateInterfaceHovering(PlayerHoverState.NOT_HOVERING);
        }),
    );

    // Handle immediate leave
    subscription.add(
      leaveEvents$.subscribe((e) => {
        if (!e.relatedTarget && !document.hasFocus()) {
          updateInterfaceHovering(PlayerHoverState.NOT_HOVERING);
        }
      }),
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [containerEl, updateInterfaceHovering]);
}

function BaseContainer(props: { children?: ReactNode }) {
  const containerEl = useRef<HTMLDivElement>(null!);
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
  const pipMode = usePlayerStore((s) => s.interface.pictureInPictureMode);

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
    if (status === "playing" && pipMode !== "desktop") {
      root.dataset.libmpvPlayer = "true";
    } else {
      delete root.dataset.libmpvPlayer;
    }

    return () => {
      delete root.dataset.libmpvPlayer;
    };
  }, [status, pipMode]);

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
