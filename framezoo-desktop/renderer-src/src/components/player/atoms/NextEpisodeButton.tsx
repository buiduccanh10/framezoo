import classNames from "classnames";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAsync } from "react-use";

import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import { usePlayerMeta } from "@/components/player/hooks/usePlayerMeta";
import { getNextEpisodeVisibility } from "@/components/player/utils/controlVisibility";
import {
  getNextEpisodeAction,
  resolveNextEpisodeAction,
} from "@/components/player/utils/episodeNavigation";
import { isPlaybackInteractionLocked } from "@/components/player/utils/playbackLock";
import { Transition } from "@/components/utils/Transition";
import { PlayerMeta } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";
import { useProgressStore } from "@/stores/progress";
import { isAutoplayAllowed } from "@/utils/autoplay";

function ActionButton(props: {
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

export function NextEpisodeButton(props: {
  controlsShowing: boolean;
  onChange?: (meta: PlayerMeta) => void;
  inControl: boolean;
  showAsButton?: boolean;
  /** When true (e.g. in credits-to-end segment), show regardless of time/duration. */
  forceShow?: boolean;
}) {
  const { t } = useTranslation();
  const duration = usePlayerStore((s) => s.progress.duration);
  const isHidden = usePlayerStore((s) => s.interface.hideNextEpisodeBtn);
  const meta = usePlayerStore((s) => s.meta);
  const { setDirectMeta } = usePlayerMeta();
  const metaType = usePlayerStore((s) => s.meta?.type);
  const time = usePlayerStore((s) => s.progress.time);
  const mediaPlaying = usePlayerStore((s) => s.mediaPlaying);
  const isSubtitleSyncActive = usePlayerStore((s) => s.subtitleSync.active);
  const isPlaybackLocked = isPlaybackInteractionLocked(
    mediaPlaying,
    isSubtitleSyncActive,
  );
  const enableSkipCredits = usePreferencesStore((s) => s.enableSkipCredits);
  const autoplayEnabled = isAutoplayAllowed();
  const timeBasedState = getNextEpisodeVisibility(time, duration);
  const showingState = props.forceShow ? "always" : timeBasedState;
  const status = usePlayerStore((s) => s.status);
  const setShouldStartFromBeginning = usePlayerStore(
    (s) => s.setShouldStartFromBeginning,
  );
  const setNextEpisodeAction = usePlayerStore((s) => s.setNextEpisodeAction);
  const updateItem = useProgressStore((s) => s.updateItem);

  const directNextAction = useMemo(() => getNextEpisodeAction(meta), [meta]);
  const resolvedNextAction = useAsync(async () => {
    if (directNextAction || !meta) return null;
    return resolveNextEpisodeAction(meta);
  }, [
    meta?.tmdbId,
    meta?.season?.tmdbId,
    meta?.episode?.tmdbId,
    meta?.episode?.number,
    directNextAction?.episode.tmdbId,
  ]);
  const nextAction =
    directNextAction ||
    (resolvedNextAction.loading ? null : resolvedNextAction.value) ||
    null;
  const nextEp = nextAction?.episode;
  const isNextSeason = nextAction?.isSeasonChange ?? false;

  useEffect(() => {
    setNextEpisodeAction(nextAction);
  }, [
    nextAction?.episode.tmdbId,
    nextAction?.episode.number,
    nextAction?.episode.title,
    nextAction?.season?.tmdbId,
    nextAction?.isSeasonChange,
    setNextEpisodeAction,
    nextAction,
  ]);

  let show = false;
  const hasAutoplayed = useRef(false);
  if (showingState === "always") show = true;
  else if (showingState === "hover" && props.controlsShowing) show = true;
  if (isHidden || status !== "playing" || duration === 0) show = false;

  const animation = showingState === "hover" ? "slide-up" : "fade";
  let bottom = "bottom-[calc(6rem+env(safe-area-inset-bottom))]";
  if (showingState === "always")
    bottom = props.controlsShowing
      ? bottom
      : "bottom-[calc(3rem+env(safe-area-inset-bottom))]";

  const loadNextEpisode = useCallback(() => {
    if (!meta || !nextEp || (!props.showAsButton && isPlaybackLocked)) return;

    const metaCopy = { ...meta };
    metaCopy.episode = nextEp;
    metaCopy.season =
      isNextSeason && nextAction.season
        ? {
            ...nextAction.season,
          }
        : metaCopy.season;
    setShouldStartFromBeginning(true);
    setDirectMeta(metaCopy);
    props.onChange?.(metaCopy);
    const defaultProgress = { duration: 0, watched: 0 };
    updateItem({
      meta: metaCopy,
      progress: defaultProgress,
    });
  }, [
    setDirectMeta,
    nextEp,
    meta,
    props,
    setShouldStartFromBeginning,
    updateItem,
    isNextSeason,
    nextAction,
    isPlaybackLocked,
  ]);

  const startCurrentEpisodeFromBeginning = useCallback(() => {
    if (!meta || !meta.episode || isPlaybackLocked) return;
    const metaCopy = { ...meta };
    setShouldStartFromBeginning(true);
    setDirectMeta(metaCopy);
    props.onChange?.(metaCopy);
    const defaultProgress = { duration: 0, watched: 0 };
    updateItem({
      meta: metaCopy,
      progress: defaultProgress,
    });
  }, [
    setDirectMeta,
    meta,
    props,
    setShouldStartFromBeginning,
    updateItem,
    isPlaybackLocked,
  ]);

  useEffect(() => {
    if (!autoplayEnabled || metaType !== "show" || isPlaybackLocked) {
      return;
    }
    const onePercent = duration / 100;

    // When skipCredits is enabled, use the 99% threshold; otherwise require 100% completion
    const isEnding = enableSkipCredits
      ? time >= duration - onePercent && duration !== 0 // 99% completion
      : time >= duration && duration !== 0; // 100% completion

    if (duration === 0) hasAutoplayed.current = false;
    if (isEnding && !hasAutoplayed.current && nextAction) {
      hasAutoplayed.current = true;
      loadNextEpisode();
    }
  }, [
    autoplayEnabled,
    duration,
    enableSkipCredits,
    loadNextEpisode,
    metaType,
    time,
    isPlaybackLocked,
    nextAction,
  ]);

  if (!props.inControl) return null;
  if (!meta?.episode || !nextEp) return null;
  if (metaType !== "show") return null;

  if (props.showAsButton) {
    return (
      <Button
        onClick={() => loadNextEpisode()}
        theme="secondary"
        padding="md:px-12 p-2.5"
        className="w-full"
      >
        <Icon className="mr-2" icon={Icons.SKIP_EPISODE} />
        {isNextSeason
          ? t("player.nextEpisode.nextSeason")
          : t("player.nextEpisode.next")}
      </Button>
    );
  }

  return (
    <Transition
      animation={animation}
      show={show}
      className="absolute right-[calc(3rem+env(safe-area-inset-right))] bottom-0"
    >
      <div
        className={classNames([
          "absolute bottom-0 right-0 transition-[bottom] duration-200 flex items-center space-x-3",
          bottom,
        ])}
      >
        <ActionButton
          className="py-px box-content bg-buttons-secondary hover:bg-buttons-secondaryHover bg-opacity-90 text-buttons-secondaryText justify-center items-center"
          onClick={() => startCurrentEpisodeFromBeginning()}
          disabled={isPlaybackLocked}
        >
          {t("player.nextEpisode.replay")}
        </ActionButton>
        <ActionButton
          onClick={() => loadNextEpisode()}
          disabled={isPlaybackLocked}
          className="bg-buttons-primary hover:bg-buttons-primaryHover text-buttons-primaryText flex justify-center items-center"
        >
          <Icon className="text-xl mr-1" icon={Icons.SKIP_EPISODE} />
          {isNextSeason
            ? t("player.nextEpisode.nextSeason")
            : t("player.nextEpisode.next")}
        </ActionButton>
      </div>
    </Transition>
  );
}
