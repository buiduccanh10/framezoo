import { ReactNode, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { BrandPill } from "@/components/layout/BrandPill";
import { Player } from "@/components/player";
import { PlayerLoadingOverlay } from "@/components/player/atoms/PlayerLoadingOverlay";
import { SkipSegmentButton } from "@/components/player/atoms/SkipSegmentButton";
import { ThumbsFeedback } from "@/components/player/atoms/ThumbsFeedback";
import { WatchPartyStatus } from "@/components/player/atoms/WatchPartyStatus";
import { useShouldShowControls } from "@/components/player/hooks/useShouldShowControls";
import {
  SegmentData,
  useSkipTime,
} from "@/components/player/hooks/useSkipTime";
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

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isPWA = window.matchMedia("(display-mode: standalone)").matches;

  const [isShifting, setIsShifting] = useState(false);
  const [isHoldingFullscreen, setIsHoldingFullscreen] = useState(false);
  const holdTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Shift") {
      setIsShifting(true);
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.key === "Shift") {
      setIsShifting(false);
    }
  });

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
      <PlayerLoadingOverlay />

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
        <div className="grid grid-cols-[1fr,auto] xl:grid-cols-3 items-center gap-2">
          <div className="flex min-w-0 items-center gap-1 ssm:gap-2">
            <Player.BackLink url={props.backUrl} />
            <span className="text mx-3 text-type-secondary">/</span>
            <div className="min-w-0 max-w-full flex-1">
              <Player.Title />
            </div>

            {isMobile && meta?.type === "show" && (
              <span className="text-type-secondary text-sm whitespace-nowrap flex-shrink-0">
                {t("media.episodeDisplay", {
                  season: meta?.season?.number,
                  episode: meta?.episode?.number,
                })}
              </span>
            )}

            <div className="flex items-center flex-shrink-0">
              <Player.InfoButton />
              <Player.BookmarkButton />
            </div>
          </div>
          <div className="text-center hidden xl:flex justify-center items-center">
            <Player.EpisodeTitle />
          </div>
          <div className="hidden lg:flex items-center justify-end">
            <BrandPill />
          </div>
          <div className="flex lg:hidden items-center justify-end">
            {status === playerStatus.PLAYING ? (
              <>
                <Player.Airplay />
                <Player.Chromecast />
              </>
            ) : null}
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
                <Player.Pause />
                <Player.SkipBackward inControl={inControl} />
                <Player.SkipForward inControl={inControl} />
                <Player.Volume />
                <Player.Time />
              </>
            ) : null}
          </Player.LeftSideControls>
          <div className="flex items-center space-x-6">
            <Player.Episodes inControl={inControl} />
            <Player.SkipEpisodeButton
              inControl={inControl}
              onChange={props.onMetaChange}
            />
            {status === playerStatus.PLAYING ? (
              <>
                <Player.Pip />
                <Player.Airplay />
                <Player.Chromecast />
              </>
            ) : null}
            {status === playerStatus.PLAYBACK_ERROR ||
            status === playerStatus.PLAYING ? (
              <Player.Captions />
            ) : null}
            <Player.Settings />
            {isShifting || isHoldingFullscreen ? (
              <Player.Widescreen />
            ) : (
              <Player.Fullscreen />
            )}
          </div>
        </div>
        <div className="grid grid-cols-[2rem,minmax(0,1fr),2rem] gap-1 ssm:gap-2 lg:hidden">
          <div />
          <div className="flex max-w-full items-center justify-center gap-1 ssm:gap-2">
            {/* Disable PiP for iOS PWA */}
            {!(isPWA && isIOS) && status === playerStatus.PLAYING && (
              <Player.Pip
                iconSizeClass="text-[22px] ssm:text-[24px]"
                className="p-2 ssm:p-2.5"
              />
            )}
            {status === playerStatus.PLAYING && (
              <Player.Pause
                iconSizeClass="text-[22px] ssm:text-[24px]"
                className="p-2 ssm:p-2.5"
              />
            )}
            {status === playerStatus.PLAYING && (
              <Player.Volume
                iconSizeClass="text-[22px] ssm:text-[24px]"
                className="shrink-0"
              />
            )}
            <Player.Episodes
              inControl={inControl}
              compact
              iconSizeClass="text-[22px] ssm:text-[24px]"
              className="p-2 ssm:p-2.5"
            />
            {status === playerStatus.PLAYING ? (
              <div className="hidden ssm:block">
                <Player.Captions
                  iconSizeClass="text-[22px] ssm:text-[24px]"
                  className="p-2 ssm:p-2.5"
                />
              </div>
            ) : null}
            <Player.Settings
              iconSizeClass="text-[22px] ssm:text-[24px]"
              className="p-2 ssm:p-2.5"
            />
          </div>
          <div>
            {status === playerStatus.PLAYING && !isMobile && (
              <div
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                className="select-none touch-none"
                style={{ WebkitTapHighlightColor: "transparent" }}
              >
                {isHoldingFullscreen ? (
                  <Player.Widescreen />
                ) : (
                  <Player.Fullscreen />
                )}
              </div>
            )}
          </div>
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
        controlsShowing={showTargets}
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
