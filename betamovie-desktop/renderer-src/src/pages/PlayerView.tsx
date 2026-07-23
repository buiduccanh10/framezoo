import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { DetailedMeta } from "@/backend/metadata/getmeta";
import { usePlayer } from "@/components/player/hooks/usePlayer";
import { usePlayerMeta } from "@/components/player/hooks/usePlayerMeta";
import { clearTorrentSession } from "@/desktop/torrentPlaybackStore";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { MetaPart } from "@/pages/parts/player/MetaPart";
import { PlayerPart } from "@/pages/parts/player/PlayerPart";
import { ResumePart } from "@/pages/parts/player/ResumePart";
import { SourceSelectPart } from "@/pages/parts/player/SourceSelectPart";
import { useLastNonPlayerLink } from "@/stores/history";
import {
  PlayerMeta,
  PlayerNavigationState,
  playerStatus,
} from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";
import { getProgressPercentage, useProgressStore } from "@/stores/progress";
import { getSavedProgressItem } from "@/stores/progress/selectors";

import { BlurEllipsis } from "./layouts/SubPageLayout";

export function RealPlayerView() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{
    media: string;
    episode?: string;
    season?: string;
  }>();
  const { status, reset, setStatus } = usePlayer();
  const sourceId = usePlayerStore((s) => s.sourceId);
  const setPlayerStoreMeta = usePlayerStore((s) => s.setMeta);
  const { playerMeta, setPlayerMeta } = usePlayerMeta();
  const backUrl = useLastNonPlayerLink();
  const setLastSuccessfulSource = usePreferencesStore(
    (s) => s.setLastSuccessfulSource,
  );
  const router = useOverlayRouter("settings");
  const openedWatchPartyRef = useRef<boolean>(false);
  const progressItems = useProgressStore((s) => s.items);
  const preloadedMeta = (
    location.state as PlayerNavigationState | null | undefined
  )?.playerMeta;

  // Reset last successful source when leaving the player
  useEffect(() => {
    return () => {
      setLastSuccessfulSource(null);
    };
  }, [setLastSuccessfulSource]);

  const paramsData = JSON.stringify({
    media: params.media,
    season: params.season,
    episode: params.episode,
  });
  useEffect(() => {
    reset();
    openedWatchPartyRef.current = false;
    return () => {
      reset();
    };
  }, [paramsData, reset]);

  useEffect(() => {
    return () => {
      void clearTorrentSession();
    };
  }, [paramsData]);

  // Auto-open watch party menu if URL contains watchparty parameter
  useEffect(() => {
    if (openedWatchPartyRef.current) return;

    if (status === playerStatus.PLAYING) {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has("watchparty")) {
        setTimeout(() => {
          router.navigate("/watchparty");
          openedWatchPartyRef.current = true;
        }, 1000);
      }
    }
  }, [status, router]);

  const metaChange = useCallback(
    (meta: PlayerMeta) => {
      if (meta?.type === "show")
        navigate(
          `/media/${params.media}/${meta.season?.tmdbId}/${meta.episode?.tmdbId}`,
        );
      else navigate(`/media/${params.media}`);
    },
    [navigate, params],
  );

  // Check if episode is more than 80% watched
  const shouldShowResumeScreen = useCallback(
    (meta: PlayerMeta) => {
      const savedProgress = getSavedProgressItem(progressItems, meta);
      if (!savedProgress) return false;

      const percentage = getProgressPercentage(
        savedProgress.watched,
        savedProgress.duration,
      );
      return percentage > 80;
    },
    [progressItems],
  );

  useEffect(() => {
    if (!preloadedMeta) return;

    setPlayerStoreMeta(
      preloadedMeta,
      shouldShowResumeScreen(preloadedMeta)
        ? playerStatus.RESUME
        : playerStatus.SCRAPING,
    );
  }, [preloadedMeta, setPlayerStoreMeta, shouldShowResumeScreen]);

  const handleMetaReceived = useCallback(
    (detailedMeta: DetailedMeta, episodeId?: string) => {
      const nextMeta = setPlayerMeta(detailedMeta, episodeId);
      if (nextMeta && shouldShowResumeScreen(nextMeta)) {
        setStatus(playerStatus.RESUME);
      }
    },
    [shouldShowResumeScreen, setStatus, setPlayerMeta],
  );

  const handleResume = useCallback(() => {
    setStatus(playerStatus.SCRAPING);
  }, [setStatus]);

  const handleRestart = useCallback(() => {
    setStatus(playerStatus.SCRAPING);
  }, [setStatus]);

  return (
    <PlayerPart backUrl={backUrl} onMetaChange={metaChange}>
      {status !== playerStatus.PLAYING ? <BlurEllipsis /> : null}
      {status === playerStatus.IDLE && !preloadedMeta ? (
        <MetaPart onGetMeta={handleMetaReceived} />
      ) : null}
      {status === playerStatus.RESUME ? (
        <ResumePart
          onResume={handleResume}
          onRestart={handleRestart}
          onMetaChange={metaChange}
        />
      ) : null}
      {(status === playerStatus.SCRAPING ||
        status === playerStatus.PLAYBACK_ERROR) &&
      playerMeta ? (
        <SourceSelectPart
          meta={playerMeta}
          mode={status === playerStatus.PLAYBACK_ERROR ? "full" : "initial"}
          onCancel={() =>
            setStatus(sourceId ? playerStatus.PLAYING : playerStatus.IDLE)
          }
          onSelected={() => setStatus(playerStatus.PLAYING)}
        />
      ) : null}
    </PlayerPart>
  );
}

export function PlayerView() {
  return <RealPlayerView />;
}

export default PlayerView;
