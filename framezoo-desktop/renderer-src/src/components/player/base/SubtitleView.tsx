import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import { usePlaybackClock } from "@/components/player/hooks/usePlaybackClock";
import {
  type CaptionCueType,
  captionIsVisible,
  makeQueId,
  sanitize,
  tryParseCanonicalVtt,
} from "@/components/player/utils/captions";
import { getDocumentPictureInPictureRoots } from "@/components/player/utils/documentPictureInPicture";
import { usePlayerStore } from "@/stores/player/store";
import { SubtitleStyling, useSubtitleStore } from "@/stores/subtitles";

export const wordOverrides: Record<string, string> = {
  // Example: i: "I", but in polish "i" is "and" so this is disabled.
};

export const DUAL_SUBTITLE_SIZE_SCALE = 0.78;
export const SECONDARY_SUBTITLE_SIZE_SCALE = 0.88;

// While the user is scrubbing (or the display is seeking/buffering), the video frame
// lags the timeline. Rendering cues for the in-flight time makes subtitles
// flash ahead of the picture, so keep the last stable set of cues until the
// seek or buffer settles.
function useSeekFrozenCaptions<T>(
  visibleCaptions: T[],
  isFrozen: boolean,
): T[] {
  const lastStableCaptions = useRef<T[]>([]);

  useEffect(() => {
    if (!isFrozen) {
      lastStableCaptions.current = visibleCaptions;
    }
  });

  return isFrozen ? lastStableCaptions.current : visibleCaptions;
}

type VisibleCaptionCue = {
  cue: CaptionCueType;
  sourceIndex: number;
};

function getCaptionCueKey(caption: VisibleCaptionCue): string {
  return makeQueId(caption.sourceIndex, caption.cue.start, caption.cue.end);
}

function getRenderedSubtitleStyling(
  styling: SubtitleStyling,
  dualSubEnabled: boolean,
  primaryStyling?: SubtitleStyling,
) {
  if (!dualSubEnabled) return styling;

  const dualSize = styling.size * DUAL_SUBTITLE_SIZE_SCALE;
  const secondarySizeLimit = primaryStyling
    ? primaryStyling.size *
      DUAL_SUBTITLE_SIZE_SCALE *
      SECONDARY_SUBTITLE_SIZE_SCALE
    : Number.POSITIVE_INFINITY;

  return {
    ...styling,
    size: Math.min(
      dualSize * (primaryStyling ? SECONDARY_SUBTITLE_SIZE_SCALE : 1),
      secondarySizeLimit,
    ),
  };
}

export function CaptionCue({
  text,
  styling,
  overrideCasing,
  useNativePictureInPictureStyle = false,
}: {
  text?: string;
  styling: SubtitleStyling;
  overrideCasing: boolean;
  useNativePictureInPictureStyle?: boolean;
}) {
  const parsedHtml = useMemo(() => {
    let textToUse = text;
    if (overrideCasing && text) {
      textToUse = text.slice(0, 1) + text.slice(1).toLowerCase();
    }

    const textWithNewlines = (textToUse || "")
      .split(" ")
      .map((word) => wordOverrides[word] ?? word)
      .join(" ")
      .replaceAll(/ i'/g, " I'")
      .replaceAll(/\r?\n/g, "<br />");

    // https://www.w3.org/TR/webvtt1/#dom-construction-rules
    // added a <br /> for newlines
    const html = sanitize(textWithNewlines, {
      ALLOWED_TAGS: ["c", "b", "i", "u", "span", "ruby", "rt", "br"],
      ADD_TAGS: ["v", "lang"],
      ALLOWED_ATTR: ["title", "lang"],
    });

    return html;
  }, [text, overrideCasing]);

  const getTextEffectStyles = () => {
    switch (styling.fontStyle) {
      case "raised":
        return {
          textShadow: "0 2px 0 rgba(0,0,0,0.8), 0 1.5px 1.5px rgba(0,0,0,0.9)",
        };
      case "depressed":
        return {
          textShadow:
            "0 -2px 0 rgba(0,0,0,0.8), 0 -1.5px 1.5px rgba(0,0,0,0.9)",
        };
      case "Border": {
        const thickness = Math.max(
          0.5,
          Math.min(5, styling.borderThickness || 1),
        );
        const shadowColor = "rgba(0,0,0,0.8)";
        return {
          textShadow: [
            `${thickness}px ${thickness}px 0 ${shadowColor}`,
            `-${thickness}px ${thickness}px 0 ${shadowColor}`,
            `${thickness}px -${thickness}px 0 ${shadowColor}`,
            `-${thickness}px -${thickness}px 0 ${shadowColor}`,
            `${thickness}px 0 0 ${shadowColor}`,
            `-${thickness}px 0 0 ${shadowColor}`,
            `0 ${thickness}px 0 ${shadowColor}`,
            `0 -${thickness}px 0 ${shadowColor}`,
          ].join(", "),
        };
      }
      case "dropShadow":
        return { textShadow: "2.5px 2.5px 4.5px rgba(0,0,0,0.9)" };
      case "default":
      default:
        return { textShadow: "0 2px 4px rgba(0,0,0,0.5)" }; // Default is a light drop shadow
    }
  };

  const textEffectStyles = getTextEffectStyles();

  const bgOpacity = styling.backgroundOpacity;
  const showBackgroundBlur =
    bgOpacity > 0 &&
    styling.backgroundBlurEnabled &&
    styling.backgroundBlur !== 0;
  const nativePictureInPictureStyles = useNativePictureInPictureStyle
    ? {
        display: "inline-block",
        marginBottom: "0.35rem",
        borderRadius: "0.22em",
        padding: "0.18em 0.7em",
        textAlign: "center" as const,
        lineHeight: 1.35,
        color: "var(--framezoo-pip-subtitle-color, #fff)",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif',
        fontSize: "clamp(18px, 4.2vh, 30px)",
        backgroundColor:
          "var(--framezoo-pip-subtitle-background, rgba(0,0,0,0.78))",
        backdropFilter: "none",
        fontWeight: "var(--framezoo-pip-subtitle-font-weight, 500)",
        textShadow:
          "var(--framezoo-pip-subtitle-text-shadow, 0 2px 4px rgba(0,0,0,0.92))",
      }
    : null;

  return (
    <p
      className="mb-1 inline-block max-w-[90vw] break-words rounded px-4 py-1 text-center leading-normal"
      style={{
        ...(nativePictureInPictureStyles ?? {
          marginBottom: "0.25rem",
          borderRadius: "0.25rem",
          padding: "0.25rem 1rem",
          textAlign: "center",
          lineHeight: 1.5,
          color: styling.color,
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          fontSize: `${(1.5 * styling.size).toFixed(2)}em`,
          backgroundColor: `rgba(0,0,0,${bgOpacity.toFixed(2)})`,
          backdropFilter: showBackgroundBlur
            ? `blur(${Math.floor(styling.backgroundBlur * 64)}px)`
            : "none",
          fontWeight: styling.bold ? "bold" : "normal",
          ...textEffectStyles,
        }),
      }}
    >
      <span
        // Sanitised a few lines up

        dangerouslySetInnerHTML={{
          __html: parsedHtml,
        }}
        dir="ltr"
      />
    </p>
  );
}

function SubtitleTrackSlot({
  currentCaptions,
  styling,
  overrideCasing,
  useNativePictureInPictureStyle = false,
  opacity = 1,
}: {
  currentCaptions: VisibleCaptionCue[];
  nextCaption?: VisibleCaptionCue | null;
  styling: SubtitleStyling;
  overrideCasing: boolean;
  useNativePictureInPictureStyle?: boolean;
  opacity?: number;
  layoutKey?: string;
}) {
  return (
    <div
      className="relative flex w-full flex-col items-center justify-center text-center"
      style={{ opacity }}
    >
      {currentCaptions.map(({ cue, sourceIndex }) => (
        <CaptionCue
          key={getCaptionCueKey({ cue, sourceIndex })}
          text={cue.content}
          styling={styling}
          overrideCasing={overrideCasing}
          useNativePictureInPictureStyle={useNativePictureInPictureStyle}
        />
      ))}
    </div>
  );
}

export function SubtitleRenderer(props?: {
  useNativePictureInPictureStyle?: boolean;
}) {
  const videoTime = usePlaybackClock();
  const vttData = usePlayerStore((s) => s.caption.selected?.vttData);
  const dualSubEnabled = usePlayerStore((s) => s.caption.dualSubEnabled);
  const isSeeking = usePlayerStore((s) => s.interface.isSeeking);
  const isLoading = usePlayerStore((s) => s.mediaPlaying.isLoading);
  const styling = useSubtitleStore((s) => s.styling);
  const overrideCasing = useSubtitleStore((s) => s.overrideCasing);
  const delay = useSubtitleStore((s) => s.primaryDelay);
  const renderedStyling = getRenderedSubtitleStyling(styling, dualSubEnabled);

  const parsedCaptions = useMemo(
    () => tryParseCanonicalVtt(vttData),
    [vttData],
  );

  const visibleCaptions = useMemo(
    () =>
      parsedCaptions.flatMap((cue, sourceIndex) =>
        captionIsVisible(cue.start, cue.end, delay, videoTime)
          ? [{ cue, sourceIndex }]
          : [],
      ),
    [parsedCaptions, videoTime, delay],
  );

  const captionsToRender = useSeekFrozenCaptions<VisibleCaptionCue>(
    visibleCaptions,
    isSeeking || isLoading,
  );

  return (
    <SubtitleTrackSlot
      currentCaptions={captionsToRender}
      styling={renderedStyling}
      overrideCasing={overrideCasing}
      useNativePictureInPictureStyle={props?.useNativePictureInPictureStyle}
      layoutKey={`${vttData ?? ""}|${renderedStyling.size}|${renderedStyling.bold}|${props?.useNativePictureInPictureStyle ? "pip" : "player"}`}
    />
  );
}

export function SecondarySubtitleRenderer(props?: {
  useNativePictureInPictureStyle?: boolean;
}) {
  const videoTime = usePlaybackClock();
  const vttData = usePlayerStore((s) => s.caption.secondary?.vttData);
  const dualSubEnabled = usePlayerStore((s) => s.caption.dualSubEnabled);
  const isSeeking = usePlayerStore((s) => s.interface.isSeeking);
  const isLoading = usePlayerStore((s) => s.mediaPlaying.isLoading);
  const primaryStyling = useSubtitleStore((s) => s.styling);
  const styling = useSubtitleStore((s) => s.secondaryStyling);
  const overrideCasing = useSubtitleStore((s) => s.overrideCasing);
  const delay = useSubtitleStore((s) => s.secondaryDelay);
  const renderedStyling = getRenderedSubtitleStyling(
    styling,
    dualSubEnabled,
    primaryStyling,
  );

  const parsedCaptions = useMemo(
    () => tryParseCanonicalVtt(vttData),
    [vttData],
  );

  const visibleCaptions = useMemo(
    () =>
      parsedCaptions.flatMap((cue, sourceIndex) =>
        captionIsVisible(cue.start, cue.end, delay, videoTime)
          ? [{ cue, sourceIndex }]
          : [],
      ),
    [parsedCaptions, videoTime, delay],
  );

  const captionsToRender = useSeekFrozenCaptions<VisibleCaptionCue>(
    visibleCaptions,
    isSeeking || isLoading,
  );

  if (!vttData) return null;

  return (
    <SubtitleTrackSlot
      currentCaptions={captionsToRender}
      styling={renderedStyling}
      overrideCasing={overrideCasing}
      useNativePictureInPictureStyle={props?.useNativePictureInPictureStyle}
      opacity={0.9}
      layoutKey={`${vttData}|${renderedStyling.size}|${renderedStyling.bold}|${props?.useNativePictureInPictureStyle ? "pip" : "player"}`}
    />
  );
}

export function SubtitleView(props: { controlsShown: boolean }) {
  const status = usePlayerStore((s) => s.status);
  const hasRenderedFrame = usePlayerStore(
    (s) => s.mediaPlaying.hasRenderedFrame,
  );
  const caption = usePlayerStore((s) => s.caption.selected);
  const secondaryCaption = usePlayerStore((s) => s.caption.secondary);
  const dualSubEnabled = usePlayerStore((s) => s.caption.dualSubEnabled);
  const captionAsTrack = usePlayerStore((s) => s.caption.asTrack);
  const source = usePlayerStore((s) => s.source);
  const display = usePlayerStore((s) => s.display);
  const isCasting = display?.getType() === "casting";
  const styling = useSubtitleStore((s) => s.styling);
  const pictureInPictureMode = usePlayerStore(
    (s) => s.interface.pictureInPictureMode,
  );
  const documentPictureInPictureWindow = usePlayerStore(
    (s) => s.interface.documentPictureInPictureWindow,
  );
  const documentPictureInPictureRoots =
    pictureInPictureMode === "document"
      ? getDocumentPictureInPictureRoots(documentPictureInPictureWindow)
      : null;
  const shouldUseDocumentPictureInPictureCaptionStyle =
    pictureInPictureMode === "document";
  // Hide custom captions only when the display explicitly requires
  // native subtitle tracks (e.g. native fullscreen / native PiP).
  const shouldUseNativeTrack =
    pictureInPictureMode !== "document" && captionAsTrack && source !== null;
  const hasEmbeddedPrimaryCaption = Boolean(caption?.trackId);
  const hasEmbeddedSecondaryCaption = Boolean(secondaryCaption?.trackId);
  const shouldRenderPrimaryCaption =
    Boolean(caption) && !hasEmbeddedPrimaryCaption;
  const shouldRenderSecondaryCaption =
    Boolean(secondaryCaption) && !hasEmbeddedSecondaryCaption;

  if (
    status !== "playing" ||
    !source ||
    (!hasRenderedFrame && !isCasting) ||
    shouldUseNativeTrack ||
    (!caption && !secondaryCaption) ||
    isCasting
  ) {
    return null;
  }
  if (!shouldRenderPrimaryCaption && !shouldRenderSecondaryCaption) return null;

  const subtitleView = (
    <div
      className="pointer-events-none z-50 text-white absolute w-full flex flex-col items-center"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
        color: "white",
        transition: "bottom 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        bottom:
          pictureInPictureMode === "document"
            ? "var(--framezoo-document-pip-subtitle-bottom, 1.15rem)"
            : props.controlsShown
              ? "6rem"
              : `${styling.verticalPosition}rem`,
        padding: pictureInPictureMode === "document" ? "0 6%" : undefined,
      }}
    >
      {dualSubEnabled &&
        secondaryCaption &&
        shouldRenderSecondaryCaption &&
        (!caption || secondaryCaption.vttData !== caption.vttData) && (
          <SecondarySubtitleRenderer
            useNativePictureInPictureStyle={
              shouldUseDocumentPictureInPictureCaptionStyle
            }
          />
        )}
      {shouldRenderPrimaryCaption && (
        <SubtitleRenderer
          useNativePictureInPictureStyle={
            shouldUseDocumentPictureInPictureCaptionStyle
          }
        />
      )}
    </div>
  );

  if (documentPictureInPictureRoots?.subtitleRoot) {
    return createPortal(
      subtitleView,
      documentPictureInPictureRoots.subtitleRoot,
    );
  }

  if (
    pictureInPictureMode === "document" ||
    pictureInPictureMode === "desktop"
  ) {
    return null;
  }

  return subtitleView;
}
