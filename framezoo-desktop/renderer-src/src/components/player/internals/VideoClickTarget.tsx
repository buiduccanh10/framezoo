import classNames from "classnames";
import { PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { useEffectOnce, useTimeoutFn } from "react-use";

import { Seek, SeekDirection } from "@/components/player/atoms/Seek";
import { useShouldShowVideoElement } from "@/components/player/internals/VideoContainer";
import { isPlaybackInteractionLocked } from "@/components/player/utils/playbackLock";
import { useOverlayStack } from "@/stores/interface/overlayStack";
import { PlayerHoverState } from "@/stores/player/slices/interface";
import { usePlayerStore } from "@/stores/player/store";
import { useWatchPartyStore } from "@/stores/watchParty";

export function VideoClickTarget(props: { showingControls: boolean }) {
  const show = useShouldShowVideoElement();
  const display = usePlayerStore((s) => s.display);
  const time = usePlayerStore((s) => s.progress.time);
  const isPaused = usePlayerStore((s) => s.mediaPlaying.isPaused);
  const isLoading = usePlayerStore((s) => s.mediaPlaying.isLoading);
  const hasRenderedFrame = usePlayerStore(
    (s) => s.mediaPlaying.hasRenderedFrame,
  );
  const isSubtitleSyncActive = usePlayerStore((s) => s.subtitleSync.active);
  const isPlaybackLocked = isPlaybackInteractionLocked(
    { isLoading, hasRenderedFrame, isPaused },
    isSubtitleSyncActive,
  );
  const playbackRate = usePlayerStore((s) => s.mediaPlaying.playbackRate);
  const updateInterfaceHovering = usePlayerStore(
    (s) => s.updateInterfaceHovering,
  );
  const setSpeedBoosted = usePlayerStore((s) => s.setSpeedBoosted);
  const setShowSpeedIndicator = usePlayerStore((s) => s.setShowSpeedIndicator);
  const hovering = usePlayerStore((s) => s.interface.hovering);
  const setCurrentOverlay = useOverlayStack((s) => s.setCurrentOverlay);
  const isInWatchParty = useWatchPartyStore((s) => s.enabled);
  const enableDoubleClickToSeek = true;

  const [_, cancel, reset] = useTimeoutFn(() => {
    updateInterfaceHovering(PlayerHoverState.NOT_HOVERING);
  }, 3000);
  useEffectOnce(() => {
    cancel();
  });

  const previousRateRef = useRef(playbackRate);
  const isHoldingRef = useRef(false);
  const speedIndicatorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const boostTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isPendingBoost, setIsPendingBoost] = useState(false);
  const [seekDirection, setSeekDirection] = useState<SeekDirection | null>(
    null,
  );
  const [seekId, setSeekId] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const singleTapTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isPlaybackLocked) return;

    if (singleTapTimeout.current) {
      clearTimeout(singleTapTimeout.current);
      singleTapTimeout.current = null;
    }
    if (boostTimeoutRef.current) {
      clearTimeout(boostTimeoutRef.current);
      boostTimeoutRef.current = null;
    }
    if (speedIndicatorTimeoutRef.current) {
      clearTimeout(speedIndicatorTimeoutRef.current);
      speedIndicatorTimeoutRef.current = null;
    }

    if (isHoldingRef.current) {
      display?.setPlaybackRate(previousRateRef.current);
      isHoldingRef.current = false;
    }

    setIsPendingBoost(false);
    setSpeedBoosted(false);
    setShowSpeedIndicator(false);
    setCurrentOverlay(null);
  }, [
    display,
    isPlaybackLocked,
    setCurrentOverlay,
    setShowSpeedIndicator,
    setSpeedBoosted,
  ]);

  const toggleFullscreen = useCallback(() => {
    display?.toggleFullscreen();
  }, [display]);

  const handleDoubleClick = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (isPlaybackLocked) return;

      if (!enableDoubleClickToSeek) {
        toggleFullscreen();
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const oneThird = rect.width / 3;

      if (x < oneThird) {
        display?.setTime(time - 10);
        setSeekDirection("backward");
        setSeekId((s) => s + 1);
        setIsSeeking(true);
      } else if (x > oneThird * 2) {
        display?.setTime(time + 10);
        setSeekDirection("forward");
        setSeekId((s) => s + 1);
        setIsSeeking(true);
      } else {
        toggleFullscreen();
      }
    },
    [
      display,
      toggleFullscreen,
      enableDoubleClickToSeek,
      time,
      isPlaybackLocked,
    ],
  );

  useEffect(() => {
    if (isSeeking) {
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }
      seekTimeoutRef.current = setTimeout(() => {
        setIsSeeking(false);
      }, 400);
    }
  }, [seekId, isSeeking]);

  const togglePause = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (isPlaybackLocked) return;

      // Don't toggle pause if holding for speed change
      if (!isPaused && (isLoading || !hasRenderedFrame)) {
        return;
      }

      // Cancel any pending boost if we're clicking to pause
      if (isPendingBoost) {
        clearTimeout(boostTimeoutRef.current!);
        setIsPendingBoost(false);
        isHoldingRef.current = false;
      }

      // pause on mouse click
      if (e.pointerType === "mouse") {
        if (e.button !== 0) return;
        if (isPaused) display?.play();
        else display?.pause();
        return;
      }

      // toggle on other types of clicks
      if (isSeeking) return;
      if (hovering !== PlayerHoverState.MOBILE_TAPPED) {
        updateInterfaceHovering(PlayerHoverState.MOBILE_TAPPED);
        reset();
      } else {
        updateInterfaceHovering(PlayerHoverState.NOT_HOVERING);
        cancel();
      }
    },
    [
      display,
      isPaused,
      hovering,
      updateInterfaceHovering,
      reset,
      cancel,
      isPendingBoost,
      isSeeking,
      isLoading,
      hasRenderedFrame,
      isPlaybackLocked,
    ],
  );

  const handleTap = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (isPlaybackLocked) return;

      if (e.pointerType === "mouse" && e.button !== 0) return;

      if (singleTapTimeout.current) {
        clearTimeout(singleTapTimeout.current);
        singleTapTimeout.current = null;
        handleDoubleClick(e);
      } else {
        if (!enableDoubleClickToSeek) {
          togglePause(e);
        }
        singleTapTimeout.current = setTimeout(() => {
          if (enableDoubleClickToSeek) {
            togglePause(e);
          }
          singleTapTimeout.current = null;
        }, 250);
      }
    },
    [handleDoubleClick, togglePause, enableDoubleClickToSeek, isPlaybackLocked],
  );

  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (isPlaybackLocked) return;

      if (
        ((e.pointerType === "mouse" && e.button === 0) ||
          e.pointerType === "touch") &&
        !isInWatchParty
      ) {
        if (isPaused || isLoading || !hasRenderedFrame) return; // Don't boost if video is paused or loading

        // Store current rate before changing
        previousRateRef.current = playbackRate;

        // Set a timeout before actually boosting speed
        if (boostTimeoutRef.current) {
          clearTimeout(boostTimeoutRef.current);
        }

        setIsPendingBoost(true);

        boostTimeoutRef.current = setTimeout(() => {
          // Only apply boost if we're still holding down
          isHoldingRef.current = true;
          setIsPendingBoost(false);

          // Show speed indicator
          setSpeedBoosted(true);
          setShowSpeedIndicator(true);
          setCurrentOverlay("speed");

          if (speedIndicatorTimeoutRef.current) {
            clearTimeout(speedIndicatorTimeoutRef.current);
          }

          // Set to 2x speed
          display?.setPlaybackRate(2);
        }, 300); // 300ms delay before boost takes effect
      }
    },
    [
      display,
      playbackRate,
      isPaused,
      setSpeedBoosted,
      setShowSpeedIndicator,
      setCurrentOverlay,
      isInWatchParty,
      isLoading,
      hasRenderedFrame,
      isPlaybackLocked,
    ],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (isPlaybackLocked) return;

      // If we have a pending boost that hasn't activated yet, clear it
      if (isPendingBoost) {
        clearTimeout(boostTimeoutRef.current!);
        setIsPendingBoost(false);
        handleTap(e);
        return;
      }

      if (
        isHoldingRef.current &&
        ((e.pointerType === "mouse" && e.button === 0) ||
          e.pointerType === "touch")
      ) {
        // Restore previous rate
        display?.setPlaybackRate(previousRateRef.current);
        isHoldingRef.current = false;

        // Update state for speed indicator
        setSpeedBoosted(false);

        // Set a timeout to hide the speed indicator
        if (speedIndicatorTimeoutRef.current) {
          clearTimeout(speedIndicatorTimeoutRef.current);
        }

        speedIndicatorTimeoutRef.current = setTimeout(() => {
          setShowSpeedIndicator(false);
          setCurrentOverlay(null);
          speedIndicatorTimeoutRef.current = null;
        }, 1500);
      } else {
        // Regular click handler
        handleTap(e);
      }
    },
    [
      display,
      handleTap,
      setSpeedBoosted,
      setShowSpeedIndicator,
      setCurrentOverlay,
      isPendingBoost,
      isPlaybackLocked,
    ],
  );

  // Handle case where mouse leaves the player while still pressed
  const handlePointerLeave = useCallback(() => {
    if (isPlaybackLocked) return;

    // Clear pending boost if mouse leaves
    if (isPendingBoost) {
      clearTimeout(boostTimeoutRef.current!);
      setIsPendingBoost(false);
    }

    if (isHoldingRef.current) {
      display?.setPlaybackRate(previousRateRef.current);
      isHoldingRef.current = false;

      // Update state for speed indicator
      setSpeedBoosted(false);

      // Set a timeout to hide the speed indicator
      if (speedIndicatorTimeoutRef.current) {
        clearTimeout(speedIndicatorTimeoutRef.current);
      }

      speedIndicatorTimeoutRef.current = setTimeout(() => {
        setShowSpeedIndicator(false);
        setCurrentOverlay(null);
        speedIndicatorTimeoutRef.current = null;
      }, 1500);
    }
  }, [
    display,
    setSpeedBoosted,
    setShowSpeedIndicator,
    setCurrentOverlay,
    isPendingBoost,
    isPlaybackLocked,
  ]);

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.pointerType && e.pointerType !== "mouse") return;
      updateInterfaceHovering(PlayerHoverState.MOUSE_HOVER);
    },
    [updateInterfaceHovering],
  );

  if (!show) return null;

  return (
    <>
      {seekDirection ? (
        <div
          key={seekId}
          onAnimationEnd={() => setSeekDirection(null)}
          className={
            seekDirection === "backward"
              ? "absolute inset-0 flex items-center justify-start ml-32"
              : "absolute inset-0 flex items-center justify-end mr-32"
          }
        >
          <Seek direction={seekDirection} />
        </div>
      ) : null}
      <div
        className={classNames("absolute inset-0", {
          "absolute inset-0": true,
          "cursor-none": !props.showingControls,
        })}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      />
    </>
  );
}
