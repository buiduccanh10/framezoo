import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Icon, Icons } from "@/components/Icon";
import { Flare } from "@/components/utils/Flare";
import { Transition } from "@/components/utils/Transition";
import { useSubtitleCuePopupStore } from "@/stores/subtitles";
import { durationExceedsHour, formatSeconds } from "@/utils/formatSeconds";

import { sanitize } from "../utils/captions";

const CAPTION_HTML_OPTIONS = {
  ALLOWED_TAGS: ["c", "b", "i", "u", "span", "ruby", "rt", "br"],
  ADD_TAGS: ["v", "lang"],
  ALLOWED_ATTR: ["title", "lang"],
};

export function SubtitleCuePopout() {
  const { t } = useTranslation();
  const popup = useSubtitleCuePopupStore((s) => s.popup);
  const setPopup = useSubtitleCuePopupStore((s) => s.setPopup);

  useEffect(() => {
    if (!popup) return;

    const timeout = window.setTimeout(() => {
      setPopup(null);
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [popup, setPopup]);

  const contentHtml = useMemo(() => {
    if (!popup) return "";

    return sanitize(
      popup.content.replaceAll(/\r?\n/g, "<br />"),
      CAPTION_HTML_OPTIONS,
    );
  }, [popup]);

  const label = popup
    ? t(
        popup.direction < 0
          ? "global.keyboardShortcuts.shortcuts.previousSubtitleCue"
          : "global.keyboardShortcuts.shortcuts.nextSubtitleCue",
      )
    : "";

  return (
    <Transition
      animation="slide-down"
      show={popup !== null}
      className="absolute inset-x-0 top-4 flex justify-center pointer-events-none"
    >
      <Flare.Base className="hover:flare-enabled pointer-events-auto bg-video-context-background px-4 py-3 group w-[min(22rem,calc(100vw-2rem))] rounded-lg transition-colors text-video-context-type-main">
        <Flare.Light
          enabled
          flareSize={200}
          cssColorVar="--colors-video-context-light"
          backgroundClass="bg-video-context-background duration-100"
          className="rounded-lg"
        />
        <Flare.Child className="grid grid-cols-[auto,1fr] gap-3 pointer-events-auto relative transition-transform">
          <Icon className="mt-0.5 text-2xl" icon={Icons.CAPTIONS} />
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-3 text-xs text-video-context-type-secondary">
              <span>{label}</span>
              {popup ? (
                <span className="shrink-0">
                  {formatSeconds(
                    popup.start / 1000,
                    durationExceedsHour(popup.start / 1000),
                  )}
                </span>
              ) : null}
            </div>
            <div
              className="mt-1 line-clamp-3 text-sm font-medium"
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
          </div>
        </Flare.Child>
      </Flare.Base>
    </Transition>
  );
}
