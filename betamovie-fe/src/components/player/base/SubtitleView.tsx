import { useMemo } from "react";
import { createPortal } from "react-dom";

import {
  captionIsVisible,
  makeQueId,
  parseCanonicalVtt,
  sanitize,
} from "@/components/player/utils/captions";
import { getDocumentPictureInPictureRoots } from "@/components/player/utils/documentPictureInPicture";
import { Transition } from "@/components/utils/Transition";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";
import { SubtitleStyling, useSubtitleStore } from "@/stores/subtitles";

export const wordOverrides: Record<string, string> = {
  // Example: i: "I", but in polish "i" is "and" so this is disabled.
};

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
        color: "#fff",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif',
        fontSize: "clamp(18px, 4.2vh, 30px)",
        backgroundColor: "rgba(0,0,0,0.78)",
        backdropFilter: "none",
        fontWeight: 500,
        textShadow: "0 2px 4px rgba(0,0,0,0.92)",
      }
    : null;

  return (
    <p
      className="mb-1 rounded px-4 py-1 text-center leading-normal"
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

export function SubtitleRenderer(props?: {
  useNativePictureInPictureStyle?: boolean;
}) {
  const videoTime = usePlayerStore((s) => s.progress.time);
  const vttData = usePlayerStore((s) => s.caption.selected?.vttData);
  const styling = useSubtitleStore((s) => s.styling);
  const overrideCasing = useSubtitleStore((s) => s.overrideCasing);
  const delay = useSubtitleStore((s) => s.delay);

  const parsedCaptions = useMemo(
    () => (vttData ? parseCanonicalVtt(vttData) : []),
    [vttData],
  );

  const visibleCaptions = useMemo(
    () =>
      parsedCaptions.filter(({ start, end }) =>
        captionIsVisible(start, end, delay, videoTime),
      ),
    [parsedCaptions, videoTime, delay],
  );

  return (
    <div>
      {visibleCaptions.map(({ start, end, content }, i) => (
        <CaptionCue
          key={makeQueId(i, start, end)}
          text={content}
          styling={styling}
          overrideCasing={overrideCasing}
          useNativePictureInPictureStyle={props?.useNativePictureInPictureStyle}
        />
      ))}
    </div>
  );
}

export function SecondarySubtitleRenderer(props?: {
  useNativePictureInPictureStyle?: boolean;
}) {
  const videoTime = usePlayerStore((s) => s.progress.time);
  const vttData = usePlayerStore((s) => s.caption.secondary?.vttData);
  const styling = useSubtitleStore((s) => s.styling);
  const overrideCasing = useSubtitleStore((s) => s.overrideCasing);
  const delay = useSubtitleStore((s) => s.delay);

  const parsedCaptions = useMemo(
    () => (vttData ? parseCanonicalVtt(vttData) : []),
    [vttData],
  );

  const visibleCaptions = useMemo(
    () =>
      parsedCaptions.filter(({ start, end }) =>
        captionIsVisible(start, end, delay, videoTime),
      ),
    [parsedCaptions, videoTime, delay],
  );

  if (!vttData) return null;

  const secondaryStyling = {
    ...styling,
    size: styling.size * 0.85,
    backgroundOpacity: styling.backgroundOpacity * 0.8,
  };

  return (
    <div className="opacity-90" style={{ opacity: 0.9 }}>
      {visibleCaptions.map(({ start, end, content }, i) => (
        <CaptionCue
          key={`secondary-${makeQueId(i, start, end)}`}
          text={content}
          styling={secondaryStyling}
          overrideCasing={overrideCasing}
          useNativePictureInPictureStyle={props?.useNativePictureInPictureStyle}
        />
      ))}
    </div>
  );
}

export function SubtitleView(props: { controlsShown: boolean }) {
  const caption = usePlayerStore((s) => s.caption.selected);
  const secondaryCaption = usePlayerStore((s) => s.caption.secondary);
  const dualSubEnabled = usePlayerStore((s) => s.caption.dualSubEnabled);
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
  const enableNativeSubtitles = usePreferencesStore(
    (s) => s.enableNativeSubtitles,
  );

  const asTrack = usePlayerStore((s) => s.caption.asTrack);
  const documentPictureInPictureRoots =
    pictureInPictureMode === "document"
      ? getDocumentPictureInPictureRoots(documentPictureInPictureWindow)
      : null;
  const shouldUseDocumentPictureInPictureCaptionStyle =
    pictureInPictureMode === "document";
  // Hide custom captions when native subtitles are enabled or when asTrack is true (e.g. mobile fullscreen)
  const shouldUseNativeTrack =
    pictureInPictureMode !== "document" &&
    (enableNativeSubtitles || asTrack) &&
    source !== null;
  if (shouldUseNativeTrack || (!caption && !secondaryCaption) || isCasting)
    return null;

  const subtitleView = (
    <Transition animation="slide-up" show>
      <div
        className="pointer-events-none z-50 text-white absolute w-full flex flex-col items-center transition-[bottom]"
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
          bottom:
            pictureInPictureMode === "document"
              ? "8%"
              : props.controlsShown
                ? "6rem"
                : `${styling.verticalPosition}rem`,
          padding: pictureInPictureMode === "document" ? "0 6%" : undefined,
        }}
      >
        {dualSubEnabled &&
          secondaryCaption &&
          (!caption || secondaryCaption.vttData !== caption.vttData) && (
            <SecondarySubtitleRenderer
              useNativePictureInPictureStyle={
                shouldUseDocumentPictureInPictureCaptionStyle
              }
            />
          )}
        {caption && (
          <SubtitleRenderer
            useNativePictureInPictureStyle={
              shouldUseDocumentPictureInPictureCaptionStyle
            }
          />
        )}
      </div>
    </Transition>
  );

  if (documentPictureInPictureRoots?.subtitleRoot) {
    return createPortal(
      subtitleView,
      documentPictureInPictureRoots.subtitleRoot,
    );
  }

  if (pictureInPictureMode === "document") {
    return null;
  }

  return subtitleView;
}
