import { ReactNode, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { BrandPill } from "@/components/layout/BrandPill";
import { WindowControls } from "@/components/layout/WindowControls";
import { Player } from "@/components/player";
import { PlayerLoadingOverlay } from "@/components/player/atoms/PlayerLoadingOverlay";
import { SkipSegmentButton } from "@/components/player/atoms/SkipSegmentButton";
import { ThumbsFeedback } from "@/components/player/atoms/ThumbsFeedback";
import { TorrentNetworkStatus } from "@/components/player/atoms/TorrentNetworkStatus";
import { WatchPartyStatus } from "@/components/player/atoms/WatchPartyStatus";
import { usePlayerMeta } from "@/components/player/hooks/usePlayerMeta";
import { useShouldShowControls } from "@/components/player/hooks/useShouldShowControls";
import {
  SegmentData,
  useSkipTime,
} from "@/components/player/hooks/useSkipTime";
import { DocumentPipOverlay } from "@/components/player/internals/DocumentPipOverlay";
import { PauseOverlay } from "@/components/player/overlays/PauseOverlay";
import type { DesktopPipAction } from "@/desktop/pip";
import { useIsMobile } from "@/hooks/useIsMobile";
import { PlayerMeta, playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { useProgressStore } from "@/stores/progress";
import { useWatchPartyStore } from "@/stores/watchParty";

export interface PlayerPartProps {
  children?: ReactNode;
  backUrl: string;
  onLoad?: () => void;
  onMetaChange?: (meta: PlayerMeta) => void;
  sourceLoading?: boolean;
}

export function PlayerPart(props: PlayerPartProps) {
  const { onMetaChange } = props;
  const { showTargets } = useShouldShowControls();
  const status = usePlayerStore((s) => s.status);
  const isLoading = usePlayerStore((s) => s.mediaPlaying.isLoading);
  const { isMobile } = useIsMobile();
  const { isHost, enabled } = useWatchPartyStore();
  const { t } = useTranslation();
  const meta = usePlayerStore((s) => s.meta);
  const { setDirectMeta } = usePlayerMeta();
  const setShouldStartFromBeginning = usePlayerStore(
    (s) => s.setShouldStartFromBeginning,
  );
  const updateProgress = useProgressStore((s) => s.updateItem);

  const inControl = !enabled || isHost;
  const shouldShowBottomControls = showTargets;
  const shouldShowCenterMobileControls =
    status === playerStatus.PLAYING && !isLoading && isMobile && showTargets;
  const desktopActionIconClass = "text-[32px] leading-none";
  const desktopActionButtonClass =
    "h-14 w-14 shrink-0 flex items-center justify-center";
  const desktopTextActionButtonClass =
    "h-14 w-auto px-3 shrink-0 flex items-center justify-center";
  const mobileActionIconClass = "text-[22px] leading-none ssm:text-[24px]";
  const mobileActionButtonClass = "p-2 ssm:p-2.5";

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isPWA = window.matchMedia("(display-mode: standalone)").matches;

  // State for thumbs feedback
  const [thumbsFeedbackData, setThumbsFeedbackData] = useState<{
    segment: SegmentData;
    skipTime: number;
  } | null>(null);

  const segments = useSkipTime();

  const handleSkipTriggered = useCallback(
    (segment: SegmentData, skipTime: number) => {
      setThumbsFeedbackData({ segment, skipTime });
    },
    [],
  );

  const handleThumbsFeedback = useCallback(() => {
    setThumbsFeedbackData(null);
  }, []);

  const handleDesktopPipAction = useCallback(
    (event: Event) => {
      const action = (event as CustomEvent<DesktopPipAction>).detail;
      if (!action || action.type !== "nextEpisode") return;

      const currentMeta = usePlayerStore.getState().meta;
      if (currentMeta?.type !== "show" || !currentMeta.episode) return;

      const nextEpisode = currentMeta.episodes?.find(
        (episode) => episode.number === currentMeta.episode!.number + 1,
      );
      if (!nextEpisode) return;

      const nextMeta = {
        ...currentMeta,
        episode: nextEpisode,
      };
      setShouldStartFromBeginning(true);
      setDirectMeta(nextMeta);
      onMetaChange?.(nextMeta);
      updateProgress({
        meta: nextMeta,
        progress: { duration: 0, watched: 0 },
      });
    },
    [onMetaChange, setDirectMeta, setShouldStartFromBeginning, updateProgress],
  );

  useEffect(() => {
    window.addEventListener(
      "framezoo:desktop-pip-action",
      handleDesktopPipAction,
    );
    return () => {
      window.removeEventListener(
        "framezoo:desktop-pip-action",
        handleDesktopPipAction,
      );
    };
  }, [handleDesktopPipAction]);

  return (
    <Player.Container onLoad={props.onLoad} showingControls={showTargets}>
      {props.children}
      <PauseOverlay />
      <Player.BlackOverlay
        show={showTargets && status === playerStatus.PLAYING}
      />
      <Player.EpisodesRouter onChange={props.onMetaChange} />
      <Player.SettingsRouter />
      <Player.SubtitleView controlsShown={showTargets} />
      <DocumentPipOverlay />
      <PlayerLoadingOverlay sourceLoading={props.sourceLoading} />

      {status === playerStatus.PLAYING ? (
        <Player.CenterControls>
          <Player.AutoPlayStart />
          <Player.CastingNotification />
        </Player.CenterControls>
      ) : null}

      <Player.CenterMobileControls
        className="text-white"
        show={shouldShowCenterMobileControls}
      >
        <Player.SkipBackward iconSizeClass="text-3xl" inControl={inControl} />
        <Player.Pause iconSizeClass="text-5xl" />
        <Player.SkipForward iconSizeClass="text-3xl" inControl={inControl} />
      </Player.CenterMobileControls>

      <div
        className={`absolute right-4 z-50 transition-all duration-300 ease-in-out ${
          showTargets ? "top-16" : "top-1"
        }`}
      >
        <WatchPartyStatus />
      </div>

      <Player.TopControls show={showTargets}>
        <div className="relative flex w-full items-center justify-between gap-4">
          {/* Left section: Back link, slash, responsive title, and 3 action buttons */}
          <div className="flex min-w-0 max-w-[calc(50%-80px)] md:max-w-[calc(50%-140px)] items-center gap-1 ssm:gap-2 z-10">
            <div className="shrink-0">
              <Player.BackLink url={props.backUrl} />
            </div>
            <span className="text mx-1.5 md:mx-3 text-type-secondary shrink-0 select-none">
              /
            </span>
            <div className="min-w-0 truncate">
              <Player.Title />
            </div>

            {isMobile && meta?.type === "show" && (
              <span className="text-type-secondary text-sm whitespace-nowrap shrink-0">
                {t("media.episodeDisplay", {
                  season: meta?.season?.number,
                  episode: meta?.episode?.number,
                })}
              </span>
            )}

            <div className="flex items-center shrink-0 ml-1">
              <Player.InfoButton />
              <Player.BookmarkButton />
              <Player.KeyboardCommandsButton />
            </div>
          </div>

          {/* Center section: Episode title (centered between left controls and right brand/window controls) */}
          {meta?.type === "show" ? (
            <div className="pointer-events-none absolute inset-x-0 hidden md:flex justify-center items-center px-4">
              <div className="pointer-events-auto max-w-[40%] truncate text-center">
                <Player.EpisodeTitle />
              </div>
            </div>
          ) : null}

          {/* Right section: Brand pill & Window controls (desktop) or mobile actions */}
          <div className="hidden lg:flex items-center justify-end gap-3 shrink-0 z-10">
            <BrandPill />
            <WindowControls />
          </div>
          <div className="flex lg:hidden items-center justify-end gap-2 shrink-0 z-10">
            {status === playerStatus.PLAYING ? (
              <>
                <Player.Airplay
                  iconSizeClass={mobileActionIconClass}
                  className={mobileActionButtonClass}
                />
                <Player.Chromecast />
              </>
            ) : null}
            <WindowControls />
          </div>
        </div>
      </Player.TopControls>

      <Player.BottomControls show={shouldShowBottomControls}>
        <div className="flex flex-col w-full">
          {status === playerStatus.PLAYING ? (
            <div className="w-full mb-2 flex items-center space-x-4">
              <Player.ProgressBar />
              {isMobile ? <Player.Time short /> : null}
            </div>
          ) : null}
        </div>
        <div className="hidden lg:flex justify-between" dir="ltr">
          <Player.LeftSideControls>
            {status === playerStatus.PLAYING ? (
              <>
                <Player.Pause
                  className={desktopActionButtonClass}
                  iconSizeClass={desktopActionIconClass}
                />
                <Player.SkipBackward
                  className={desktopActionButtonClass}
                  iconSizeClass={desktopActionIconClass}
                  inControl={inControl}
                />
                <Player.SkipForward
                  className={desktopActionButtonClass}
                  iconSizeClass={desktopActionIconClass}
                  inControl={inControl}
                />
                <Player.Volume
                  buttonClassName={desktopActionButtonClass}
                  iconSizeClass={desktopActionIconClass}
                />
                <Player.Time />
              </>
            ) : null}
          </Player.LeftSideControls>
          <div className="flex items-center space-x-6">
            <Player.Episodes
              className={desktopTextActionButtonClass}
              inControl={inControl}
              iconSizeClass={desktopActionIconClass}
            />
            <Player.SkipEpisodeButton
              className={desktopActionButtonClass}
              inControl={inControl}
              iconSizeClass={desktopActionIconClass}
              onChange={props.onMetaChange}
            />
            <TorrentNetworkStatus
              className={desktopActionButtonClass}
              iconSizeClass={desktopActionIconClass}
            />
            {status === playerStatus.PLAYING ? (
              <>
                <Player.Pip
                  className={desktopActionButtonClass}
                  iconSizeClass={desktopActionIconClass}
                />
                <Player.Airplay
                  className={desktopActionButtonClass}
                  iconSizeClass={desktopActionIconClass}
                />
                <Player.Chromecast className={desktopActionButtonClass} />
              </>
            ) : null}
            {status === playerStatus.PLAYBACK_ERROR ||
            status === playerStatus.PLAYING ? (
              <Player.Captions
                className={desktopActionButtonClass}
                iconSizeClass={desktopActionIconClass}
              />
            ) : null}
            <Player.Settings
              className={desktopActionButtonClass}
              iconSizeClass={desktopActionIconClass}
            />
            <Player.Fullscreen
              className={desktopActionButtonClass}
              iconSizeClass={desktopActionIconClass}
            />
          </div>
        </div>
        <div className="flex w-full items-center justify-center gap-1 ssm:gap-2 lg:hidden">
          {/* Disable PiP for iOS PWA */}
          {!(isPWA && isIOS) && status === playerStatus.PLAYING && (
            <Player.Pip
              iconSizeClass={mobileActionIconClass}
              className={mobileActionButtonClass}
            />
          )}
          {status === playerStatus.PLAYING && (
            <Player.Pause
              iconSizeClass={mobileActionIconClass}
              className={mobileActionButtonClass}
            />
          )}
          {status === playerStatus.PLAYING && (
            <Player.Volume
              iconSizeClass={mobileActionIconClass}
              className="shrink-0"
              buttonClassName={mobileActionButtonClass}
            />
          )}
          <Player.Episodes
            inControl={inControl}
            compact
            iconSizeClass={mobileActionIconClass}
            className={mobileActionButtonClass}
          />
          {status === playerStatus.PLAYING ? (
            <div className="hidden ssm:block">
              <Player.Captions
                iconSizeClass={mobileActionIconClass}
                className={mobileActionButtonClass}
              />
            </div>
          ) : null}
          <Player.Settings
            iconSizeClass={mobileActionIconClass}
            className={mobileActionButtonClass}
          />
          <TorrentNetworkStatus
            iconSizeClass="text-[20px] ssm:text-[22px]"
            className={mobileActionButtonClass}
          />
          {status === playerStatus.PLAYING && (
            <Player.Fullscreen
              iconSizeClass={mobileActionIconClass}
              className={mobileActionButtonClass}
            />
          )}
        </div>
      </Player.BottomControls>

      <Player.VolumeChangedPopout />
      <Player.SubtitleDelayPopout />
      <Player.SpeedChangedPopout />
      <Player.TIDBSubmissionSuccessPopout />
      <Player.UnreleasedEpisodeOverlay />

      <Player.NextEpisodeButton
        controlsShowing={showTargets}
        onChange={props.onMetaChange}
        inControl={inControl}
      />

      <SkipSegmentButton
        controlsShowing={showTargets || isLoading}
        segments={segments}
        inControl={inControl}
        onChangeMeta={props.onMetaChange}
        onSkipTriggered={handleSkipTriggered}
      />

      <ThumbsFeedback
        controlsShowing={showTargets}
        feedbackData={thumbsFeedbackData}
        onAction={handleThumbsFeedback}
      />
    </Player.Container>
  );
}
