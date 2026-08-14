import classNames from "classnames";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Icon, Icons } from "@/components/Icon";
import { NextEpisodeButton } from "@/components/player/atoms/NextEpisodeButton";
import {
  SegmentData,
  getSegmentBoundsSeconds,
} from "@/components/player/hooks/useSkipTime";
import { useSkipTracking } from "@/components/player/hooks/useSkipTracking";
import { isPlaybackInteractionLocked } from "@/components/player/utils/playbackLock";
import { Transition } from "@/components/utils/Transition";
import { PlayerMeta } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

const END_OF_VIDEO_TOLERANCE_SECONDS = 0.5;

function getSegmentText(
  type: "intro" | "recap" | "credits" | "preview",
  t: (key: string) => string,
): string {
  switch (type) {
    case "intro":
      return t("player.skipTime.intro");
    case "recap":
      return t("player.skipTime.recap");
    case "credits":
      return t("player.skipTime.credits");
    case "preview":
      return t("player.skipTime.preview");
    default:
      return t("player.skipTime.intro");
  }
}

function shouldShowSkipButton(
  currentTime: number,
  segment: SegmentData | null,
  duration: number,
): "always" | "hover" | "none" {
  if (!segment) return "none";

  const bounds = getSegmentBoundsSeconds(segment, duration);
  if (!bounds) return "none";

  const endSeconds =
    bounds.end !== null ? bounds.end : duration > 0 ? duration : Infinity;

  // Check if current time is within the segment
  if (currentTime >= bounds.start && currentTime <= endSeconds) {
    // Show "always" for the first 10 seconds of the segment, then "hover"
    const timeInSegment = (currentTime - bounds.start) * 1000;
    if (timeInSegment <= 10000) return "always"; // First 10 seconds
    return "hover";
  }

  return "none";
}

function isEndingAtVideoEnd(segment: SegmentData, duration: number): boolean {
  if (duration <= 0) return false;
  const bounds = getSegmentBoundsSeconds(segment, duration);
  if (!bounds) return false;

  const endSeconds = bounds.end ?? duration;
  return endSeconds >= duration - END_OF_VIDEO_TOLERANCE_SECONDS;
}

function Button(props: {
  className: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={classNames(
        "font-bold rounded h-10 w-40 scale-95 hover:scale-100 transition-all duration-200",
        props.disabled && "cursor-not-allowed opacity-50",
        props.className,
      )}
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

function SkipSegmentButton(props: {
  controlsShowing: boolean;
  segments: SegmentData[];
  inControl: boolean;
  onChangeMeta?: (meta: PlayerMeta) => void;
  onSkipTriggered?: (segment: SegmentData, skipTime: number) => void;
}) {
  const { t } = useTranslation();
  const time = usePlayerStore((s) => s.progress.time);
  const _duration = usePlayerStore((s) => s.progress.duration);
  const status = usePlayerStore((s) => s.status);
  const display = usePlayerStore((s) => s.display);
  const meta = usePlayerStore((s) => s.meta);
  const mediaPlaying = usePlayerStore((s) => s.mediaPlaying);
  const isSubtitleSyncActive = usePlayerStore((s) => s.subtitleSync.active);
  const isPlaybackLocked = isPlaybackInteractionLocked(
    mediaPlaying,
    isSubtitleSyncActive,
  );
  const { addSkipEvent } = useSkipTracking(20);

  const endingSegment =
    meta?.type === "show"
      ? props.segments.find((segment) => isEndingAtVideoEnd(segment, _duration))
      : undefined;

  // Find segments that should be shown at the current time.
  // Segments that run until video end are replaced with NextEpisodeButton.
  const activeSegments = props.segments.filter((segment) => {
    if (segment === endingSegment) return false;
    const showingState = shouldShowSkipButton(time, segment, _duration);
    return showingState !== "none";
  });

  const endingBounds = endingSegment
    ? getSegmentBoundsSeconds(endingSegment, _duration)
    : null;
  const inEndingSegment = endingBounds != null && time >= endingBounds.start;
  const showNextEpisodeButton =
    props.inControl && endingSegment != null && inEndingSegment;

  const handleSkip = useCallback(
    (segment: SegmentData) => {
      if (!display || isPlaybackLocked) return;
      const bounds = getSegmentBoundsSeconds(segment, _duration);
      if (!bounds) return;

      const startTime = time;
      // Skip to the end of the segment (or end of video if end_ms is null)
      const targetTime = bounds.end !== null ? bounds.end : _duration;
      const skipDuration = Math.max(0, targetTime - startTime);
      display.setTime(targetTime);

      // Add manual skip event with high confidence (user explicitly clicked skip)
      addSkipEvent({
        startTime,
        endTime: targetTime,
        skipDuration,
        confidence: 0.95, // High confidence for explicit user action
        meta: meta
          ? {
              title:
                meta.type === "show" && meta.episode
                  ? `${meta.title} - S${meta.season?.number || 0}E${meta.episode.number || 0}`
                  : meta.title,
              type: meta.type === "movie" ? "Movie" : "TV Show",
              tmdbId: meta.tmdbId,
              seasonNumber: meta.season?.number,
              episodeNumber: meta.episode?.number,
            }
          : undefined,
      });

      // Notify parent that skip was triggered
      if (props.onSkipTriggered) {
        props.onSkipTriggered(segment, targetTime);
      }

      // eslint-disable-next-line no-console
      console.log(`Skip ${segment.type} button used: ${skipDuration}s total`);
    },
    [display, time, _duration, addSkipEvent, meta, props, isPlaybackLocked],
  );

  if (!props.inControl) return null;
  if (status !== "playing") return null;
  if (activeSegments.length === 0 && !showNextEpisodeButton) return null;

  return (
    <>
      <div className="absolute right-[calc(3rem+env(safe-area-inset-right))] bottom-0">
        {activeSegments.map((segment, index) => {
          const showingState = shouldShowSkipButton(time, segment, _duration);
          const animation = showingState === "hover" ? "slide-up" : "fade";

          let bottom = "bottom-[calc(6rem+env(safe-area-inset-bottom))]";
          if (showingState === "always") {
            bottom = props.controlsShowing
              ? bottom
              : "bottom-[calc(3rem+env(safe-area-inset-bottom))]";
          }

          // Offset multiple buttons vertically
          const verticalOffset = index * 60; // 60px spacing between buttons
          const adjustedBottom = bottom.replace(
            /bottom-\[calc\(([^)]+)\)\]/,
            `bottom-[calc($1 + ${verticalOffset}px)]`,
          );

          let show = false;
          if (showingState === "always") show = true;
          else if (showingState === "hover" && props.controlsShowing)
            show = true;

          return (
            <Transition
              key={`${segment.type}-${segment.start_ms ?? "null"}-${segment.end_ms ?? "null"}`}
              animation={animation}
              show={show}
              className="absolute right-0"
            >
              <div
                className={classNames([
                  "absolute bottom-0 right-0 transition-[bottom] duration-200 flex items-center space-x-3",
                  adjustedBottom,
                ])}
              >
                <Button
                  onClick={() => handleSkip(segment)}
                  disabled={isPlaybackLocked}
                  className="bg-buttons-primary hover:bg-buttons-primaryHover text-buttons-primaryText flex justify-center items-center"
                >
                  <Icon className="text-xl mr-1" icon={Icons.SKIP_EPISODE} />
                  {getSegmentText(segment.type, t)}
                </Button>
              </div>
            </Transition>
          );
        })}
      </div>
      {showNextEpisodeButton && (
        <NextEpisodeButton
          controlsShowing={props.controlsShowing}
          onChange={props.onChangeMeta}
          inControl={props.inControl}
          forceShow
        />
      )}
    </>
  );
}

export { SkipSegmentButton };
