import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { DetailedMeta } from "@/backend/metadata/getmeta";
import { usePlayer } from "@/components/player/hooks/usePlayer";
import { usePlayerMeta } from "@/components/player/hooks/usePlayerMeta";
import {
  clearTorrentSession,
  useActiveTorrentStatus,
} from "@/desktop/torrentPlaybackStore";
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
import type { SourceSliceSource } from "@/stores/player/utils/qualities";
import { getProgressPercentage, useProgressStore } from "@/stores/progress";
import {
  getSavedProgressItem,
  getSavedProgressTime,
} from "@/stores/progress/selectors";

import { BlurEllipsis } from "./layouts/SubPageLayout";

export function RealPlayerView() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{
    media: string;
    episode?: string;
    season?: string;
  }>();
  const { status, reset, setStatus, setShouldStartFromBeginning } = usePlayer();
  const sourceId = usePlayerStore((s) => s.sourceId);
  const source = usePlayerStore((s) => s.source);
  const captionList = usePlayerStore((s) => s.captionList);
  const setPlayerSource = usePlayerStore((s) => s.setSource);
  const setPlayerStoreMeta = usePlayerStore((s) => s.setMeta);
  const { playerMeta, setPlayerMeta } = usePlayerMeta();
  const backUrl = useLastNonPlayerLink();
  const router = useOverlayRouter("settings");
  const openedWatchPartyRef = useRef<boolean>(false);
  const progressItems = useProgressStore((s) => s.items);
  const updateProgress = useProgressStore((s) => s.updateItem);
  const torrentStatus = useActiveTorrentStatus();
  const torrentPromotionRef = useRef<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const preloadedMeta = (
    location.state as PlayerNavigationState | null | undefined
  )?.playerMeta;

  const paramsData = JSON.stringify({
    media: params.media,
    season: params.season,
    episode: params.episode,
  });
  useEffect(() => {
    reset();
    setSourceLoading(false);
    openedWatchPartyRef.current = false;
    initializedMetaRef.current = null;
    return () => {
      reset();
    };
  }, [paramsData, reset]);

  useEffect(() => {
    return () => {
      void clearTorrentSession();
    };
  }, [paramsData]);

  useEffect(() => {
    if (!torrentStatus || torrentStatus.sourceId !== sourceId) return;

    if (torrentStatus.state === "error") {
      if (status !== playerStatus.PLAYBACK_ERROR) {
        setStatus(playerStatus.PLAYBACK_ERROR);
      }
      return;
    }

    if (
      !torrentStatus.streamType ||
      torrentStatus.streamType === "pending" ||
      !torrentStatus.streamUrl ||
      !source
    ) {
      return;
    }

    const promotionKey = [
      torrentStatus.sessionId,
      torrentStatus.streamType,
      torrentStatus.streamUrl,
    ].join(":");
    if (torrentPromotionRef.current === promotionKey) return;

    const currentUrl =
      source.type === "file" ? source.qualities.unknown?.url : null;
    if (currentUrl === torrentStatus.streamUrl) {
      torrentPromotionRef.current = promotionKey;
      return;
    }
    const promotedSource: SourceSliceSource = {
      id: source.id ?? sourceId ?? undefined,
      type: "file",
      quality: source.quality,
      qualities: {
        unknown: {
          type: "mp4",
          url: torrentStatus.streamUrl,
        },
      },
      duration: torrentStatus.duration ?? undefined,
      isTorrent: true,
    };

    torrentPromotionRef.current = promotionKey;
    setPlayerSource(
      promotedSource,
      captionList,
      torrentStatus.startAt ??
        (playerMeta ? getSavedProgressTime(progressItems, playerMeta) : 0),
    );
  }, [
    captionList,
    playerMeta,
    progressItems,
    setPlayerSource,
    source,
    sourceId,
    status,
    setStatus,
    torrentStatus,
  ]);

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

  const initializedMetaRef = useRef<string | null>(null);

  useEffect(() => {
    if (!preloadedMeta) return;

    const metaKey = `${preloadedMeta.type}:${preloadedMeta.tmdbId}:${preloadedMeta.season?.tmdbId}:${preloadedMeta.episode?.tmdbId}`;
    if (initializedMetaRef.current === metaKey) return;
    initializedMetaRef.current = metaKey;

    setPlayerStoreMeta(
      preloadedMeta,
      shouldShowResumeScreen(preloadedMeta)
        ? playerStatus.RESUME
        : playerStatus.SOURCE_SELECTION,
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
    setStatus(playerStatus.SOURCE_SELECTION);
  }, [setStatus]);

  const handleRestart = useCallback(() => {
    // Tell SourceSelectPart to start from position 0, not from saved progress.
    setShouldStartFromBeginning(true);
    // Also reset the stored progress so ProgressSaver's late-resume doesn't kick in.
    if (playerMeta) {
      updateProgress({
        meta: playerMeta,
        progress: { duration: 0, watched: 0 },
      });
    }
    setStatus(playerStatus.SOURCE_SELECTION);
  }, [setStatus, setShouldStartFromBeginning, updateProgress, playerMeta]);

  return (
    <PlayerPart
      backUrl={backUrl}
      onMetaChange={metaChange}
      sourceLoading={sourceLoading}
    >
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
      {(status === playerStatus.SOURCE_SELECTION ||
        status === playerStatus.PLAYBACK_ERROR) &&
      playerMeta ? (
        <SourceSelectPart
          meta={playerMeta}
          // Keep the fallback picker inside the player layout. "full" is
          // reserved for the Settings overlay, which provides its own frame.
          mode="initial"
          onCancel={() =>
            setStatus(sourceId ? playerStatus.PLAYING : playerStatus.IDLE)
          }
          onSelected={() => setStatus(playerStatus.PLAYING)}
          onLoadingChange={setSourceLoading}
        />
      ) : null}
    </PlayerPart>
  );
}

export function PlayerView() {
  return <RealPlayerView />;
}

export default PlayerView;
