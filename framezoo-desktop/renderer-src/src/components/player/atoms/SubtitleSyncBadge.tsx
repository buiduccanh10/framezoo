import classNames from "classnames";
import { useTranslation } from "react-i18next";

import { Icon, Icons } from "@/components/Icon";
import { useSkipTime } from "@/components/player/hooks/useSkipTime";
import {
  getSkipSegmentVisibility,
  isSegmentEndingAtVideoEnd,
} from "@/components/player/utils/controlVisibility";
import { Transition } from "@/components/utils/Transition";
import { usePlayerStore } from "@/stores/player/store";
import { useSubtitleStore } from "@/stores/subtitles";

export function SubtitleSyncBadge(props: { controlsShowing?: boolean }) {
  const caption = usePlayerStore((s) => s.caption.selected);
  const meta = usePlayerStore((s) => s.meta);
  const source = usePlayerStore((s) => s.source);
  const setCaption = usePlayerStore((s) => s.setCaption);
  const time = usePlayerStore((s) => s.progress.time);
  const duration = usePlayerStore((s) => s.progress.duration);
  const segments = useSkipTime();
  const { t } = useTranslation();

  const alignment = caption?.alignment;

  // Only render if we have a pending AI sync confirmation
  if (!caption?.isPendingSyncConfirmation || !alignment || !meta || !source)
    return null;

  const storageKey = `subtitle-sync:${meta.tmdbId || "unknown"}:${source.id || "unknown"}:${caption.id}`;

  const handleConfirm = () => {
    localStorage.setItem(storageKey, JSON.stringify(alignment));
    setCaption({ ...caption, isPendingSyncConfirmation: false });
  };

  const handleReject = () => {
    setCaption({
      ...caption,
      alignment: undefined,
      isPendingSyncConfirmation: false,
    });
    localStorage.removeItem(storageKey);
    // Reset the manual cue delay since we are rejecting the AI sync
    useSubtitleStore.getState().setPrimaryDelay(0);
  };

  // Determine if SkipSegmentButton is currently visible so we can stack above it
  const endingSegment =
    meta?.type === "show"
      ? segments.find((segment) => isSegmentEndingAtVideoEnd(segment, duration))
      : undefined;

  let activeSkipSegmentsCount = 0;
  for (const segment of segments) {
    if (segment === endingSegment) continue;
    const showingState = getSkipSegmentVisibility(time, segment, duration);
    if (
      showingState !== "none" &&
      (showingState === "always" || props.controlsShowing)
    ) {
      activeSkipSegmentsCount++;
    }
  }

  // Base offset is 6rem when controls are showing, 3rem when hidden
  // Each skip button adds roughly 60px (3.75rem), so we use 4rem for clean stacking
  const baseOffsetRem = props.controlsShowing ? 6 : 3;
  const skipOffsetRem = activeSkipSegmentsCount * 4;
  const finalOffsetRem = baseOffsetRem + skipOffsetRem;

  return (
    <div className="absolute right-[calc(3rem+env(safe-area-inset-right))] bottom-0 pointer-events-none">
      <Transition
        animation="fade"
        show={!!props.controlsShowing}
        className="absolute right-0"
      >
        <div
          className="absolute right-0 transition-[bottom] duration-200 flex flex-col items-end space-y-2 pointer-events-none"
          style={{
            bottom: `calc(${finalOffsetRem}rem + env(safe-area-inset-bottom))`,
          }}
        >
          <div className="text-sm font-medium text-white whitespace-nowrap shadow-black drop-shadow-md">
            {t(
              "player.menus.subtitles.confirmSyncTitle",
              "Đồng bộ hiện tại đúng không?",
            )}
          </div>
          <div className="flex items-center space-x-3 pointer-events-auto">
            <button
              type="button"
              onClick={handleConfirm}
              className={classNames(
                "h-10 w-10 rounded-full flex items-center justify-center pointer-events-auto",
                "bg-buttons-primary hover:bg-buttons-primaryHover text-buttons-primaryText",
                "scale-95 hover:scale-100 transition-all duration-200",
              )}
              aria-label={t("player.menus.subtitles.confirmSync", "Confirm")}
            >
              <Icon className="text-xl" icon={Icons.THUMBS_UP} />
            </button>
            <button
              type="button"
              onClick={handleReject}
              className={classNames(
                "h-10 w-10 rounded-full flex items-center justify-center pointer-events-auto",
                "bg-buttons-primary hover:bg-buttons-primaryHover text-buttons-primaryText",
                "scale-95 hover:scale-100 transition-all duration-200",
              )}
              aria-label={t("player.menus.subtitles.rejectSync", "Reject")}
            >
              <Icon className="text-xl" icon={Icons.THUMBS_DOWN} />
            </button>
          </div>
        </div>
      </Transition>
    </div>
  );
}
