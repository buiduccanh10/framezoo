import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { BrandPill } from "@/components/layout/BrandPill";
import { WindowControls } from "@/components/layout/WindowControls";
import { Player } from "@/components/player";
import { PlayerLoadingOverlay } from "@/components/player/atoms/PlayerLoadingOverlay";
import { SkipSegmentButton } from "@/components/player/atoms/SkipSegmentButton";
import { ThumbsFeedback } from "@/components/player/atoms/ThumbsFeedback";
import { TorrentNetworkStatus } from "@/components/player/atoms/TorrentNetworkStatus";
import { WatchPartyStatus } from "@/components/player/atoms/WatchPartyStatus";
import { useShouldShowControls } from "@/components/player/hooks/useShouldShowControls";
import {
  SegmentData,
  useSkipTime,
} from "@/components/player/hooks/useSkipTime";
import { DocumentPipOverlay } from "@/components/player/internals/DocumentPipOverlay";
import { PauseOverlay } from "@/components/player/overlays/PauseOverlay";
import { useIsMobile } from "@/hooks/useIsMobile";
import { PlayerMeta, playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { useWatchPartyStore } from "@/stores/watchParty";

export interface PlayerPartProps {
  children?: ReactNode;
  backUrl: string;
  onLoad?: () => void;
  onMetaChange?: (meta: PlayerMeta) => void;
  sourceLoading?: boolean;
}

export function PlayerPart(props: PlayerPartProps) {
  const { showTargets, showTouchTargets } = useShouldShowControls();
  const status = usePlayerStore((s) => s.status);
  const isLoading = usePlayerStore((s) => s.mediaPlaying.isLoading);
  const { isMobile } = useIsMobile();
  const { isHost, enabled } = useWatchPartyStore();
  const { t } = useTranslation();
  const meta = usePlayerStore((s) => s.meta);

  const inControl = !enabled || isHost;
  const shouldShowBottomControls = showTargets;
  const shouldShowCenterMobileControls =
    status === playerStatus.PLAYING &&
    !isLoading &&
    (isMobile ? showTargets : showTouchTargets);
  const desktopActionIconClass = "text-[32px] leading-none";
  const desktopActionButtonClass =
    "h-14 w-14 shrink-0 flex items-center justify-center";
  const desktopTextActionButtonClass =
    "h-14 w-auto px-3 shrink-0 flex items-center justify-center";
  const mobileActionIconClass = "text-[22px] leading-none ssm:text-[24px]";
  const mobileActionButtonClass = "p-2 ssm:p-2.5";

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isPWA = window.matchMedia("(display-mode: standalone)").matches;

  const [isShifting, setIsShifting] = useState(false);
  const [isHoldingFullscreen, setIsHoldingFullscreen] = useState(false);
  const holdTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setIsShifting(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setIsShifting(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);

      if (holdTimeoutRef.current) {
        clearTimeout(holdTimeoutRef.current);
        holdTimeoutRef.current = null;
      }
    };
  }, []);

  const handleTouchStart = () => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
    }
    holdTimeoutRef.current = setTimeout(() => {
      setIsHoldingFullscreen(true);
    }, 100);
  };

  const handleTouchEnd = () => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
    }
    holdTimeoutRef.current = setTimeout(() => {
      setIsHoldingFullscreen(false);
    }, 1000);
  };

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
        <div className="flex w-full items-center justify-between gap-4">
          {/* Left section: Back link, slash, responsive title, and 3 action buttons */}
          <div className="flex min-w-0 flex-1 items-center gap-1 ssm:gap-2">
            <div className="shrink-0">
              <Player.BackLink url={props.backUrl} />
            </div>
            <span className="text mx-1.5 md:mx-3 text-type-secondary shrink-0 select-none">
              /
            </span>
            <div className="min-w-0 max-w-fit truncate">
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

          {/* Center section: Episode title (for TV shows on large screens) */}
          {meta?.type === "show" ? (
            <div className="text-center hidden xl:flex justify-center items-center shrink-0 px-4 min-w-0 truncate">
              <Player.EpisodeTitle />
            </div>
          ) : null}

          {/* Right section: Brand pill & Window controls (desktop) or mobile actions */}
          <div className="hidden lg:flex items-center justify-end gap-3 shrink-0">
            <BrandPill />
            <WindowControls />
          </div>
          <div className="flex lg:hidden items-center justify-end gap-2 shrink-0">
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
            {isShifting || isHoldingFullscreen ? (
              <Player.Widescreen
                className={desktopActionButtonClass}
                iconSizeClass={desktopActionIconClass}
              />
            ) : (
              <Player.Fullscreen
                className={desktopActionButtonClass}
                iconSizeClass={desktopActionIconClass}
              />
            )}
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
            <div
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              className="select-none touch-none"
              style={{ WebkitTapHighlightColor: "transparent" }}
            >
              {isHoldingFullscreen ? (
                <Player.Widescreen
                  iconSizeClass={mobileActionIconClass}
                  className={`${mobileActionButtonClass} text-white`}
                />
              ) : (
                <Player.Fullscreen
                  iconSizeClass={mobileActionIconClass}
                  className={mobileActionButtonClass}
                />
              )}
            </div>
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
