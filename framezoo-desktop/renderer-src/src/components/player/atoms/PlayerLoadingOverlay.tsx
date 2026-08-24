import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { LazyImage } from "@/components/utils/Image";
import { useActiveTorrentStatus } from "@/desktop/torrentPlaybackStore";
import { PlayerStatus, playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

const MESSAGE_INITIAL_DELAY_MS = 6000;
export const STREAM_READY_THRESHOLD_BYTES = 4 * 1024 * 1024;

export interface PlayerLoadingTorrentStatus {
  state: string;
  streamType?: "pending" | "hls" | "file" | null;
  streamUrl?: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
}

export interface PlayerLoadingOverlayInput {
  status: PlayerStatus;
  sourceLoading?: boolean;
  isLoading: boolean;
  hasRenderedFrame: boolean;
  duration: number;
  buffered: number;
  torrentStatus?: PlayerLoadingTorrentStatus | null;
  isDesktopPipPlayback?: boolean;
}

export function getPlayerLoadingOverlayState(input: PlayerLoadingOverlayInput) {
  const isDesktopPipPlayback = input.isDesktopPipPlayback === true;
  const isBufferingCurrentPlaybackSegment =
    input.status === playerStatus.PLAYING &&
    input.isLoading &&
    !isDesktopPipPlayback;
  const isPreparingSource =
    input.sourceLoading && input.status === playerStatus.SOURCE_SELECTION;
  const torrentStatus = input.torrentStatus;
  const isTorrentPreparing =
    Boolean(torrentStatus) &&
    input.status === playerStatus.PLAYING &&
    torrentStatus?.state !== "error" &&
    (!input.hasRenderedFrame ||
      torrentStatus?.streamType === "pending" ||
      !torrentStatus?.streamUrl ||
      (input.duration === 0 && input.buffered === 0) ||
      !Number.isFinite(input.duration));

  const bufferedProgress =
    input.duration > 0
      ? Math.min(100, (input.buffered / input.duration) * 100)
      : 0;
  const torrentStreamTargetBytes = torrentStatus?.totalBytes
    ? Math.min(STREAM_READY_THRESHOLD_BYTES, torrentStatus.totalBytes)
    : STREAM_READY_THRESHOLD_BYTES;
  const torrentStreamProgress = torrentStatus
    ? Math.round(
        (torrentStatus.downloadedBytes / torrentStreamTargetBytes) * 100,
      )
    : 0;
  const rawLoadingProgress = torrentStatus
    ? Math.max(bufferedProgress, torrentStreamProgress)
    : bufferedProgress;

  return {
    isBufferingCurrentPlaybackSegment,
    isPreparingSource,
    isTorrentPreparing,
    showOverlay:
      !isDesktopPipPlayback &&
      (input.status === playerStatus.IDLE ||
        isPreparingSource ||
        isBufferingCurrentPlaybackSegment ||
        isTorrentPreparing ||
        (input.status === playerStatus.PLAYING && !input.hasRenderedFrame)),
    loadingProgress: Math.min(95, rawLoadingProgress),
  };
}

function getRandomMessage(messages: string[], prev?: string) {
  if (messages.length <= 1) return messages[0] ?? "";
  let next = prev ?? "";
  while (next === prev) {
    next = messages[Math.floor(Math.random() * messages.length)];
  }
  return next;
}

function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;
  });
}

function LoadingTitle(props: {
  logo?: string;
  title: string;
  progress: number;
  onError: () => void;
}) {
  const progressValue = Math.min(100, Math.max(0, props.progress));
  const progress = `${progressValue}%`;

  if (!props.logo) {
    return (
      <div className="relative max-w-full overflow-hidden text-4xl font-bold uppercase tracking-[0.28em] text-white/25 transition-[transform,opacity] duration-500 ease-out motion-safe:animate-pulse md:text-6xl">
        <span>{props.title}</span>
        <span
          className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap text-white transition-[width] duration-700 ease-out"
          style={{ width: progress, willChange: "width" }}
        >
          {props.title}
        </span>
      </div>
    );
  }

  return (
    <div className="relative w-full max-w-[16rem] md:max-w-[20rem] lg:max-w-[30rem] max-h-[12rem] motion-safe:animate-pulse">
      <LazyImage
        src={props.logo}
        alt={props.title}
        className="w-full h-full object-contain bg-transparent opacity-30 grayscale saturate-0"
        showSkeleton={false}
        loading="eager"
        decoding="sync"
        onError={props.onError}
      />
      <div
        className="pointer-events-none absolute inset-0 transition-[clip-path] duration-700 ease-out"
        style={{
          clipPath: `inset(0 ${100 - progressValue}% 0 0)`,
          willChange: "clip-path",
        }}
      >
        <LazyImage
          src={props.logo}
          alt=""
          className="h-full w-full object-contain bg-transparent"
          showSkeleton={false}
          loading="eager"
          decoding="sync"
          onError={props.onError}
        />
      </div>
    </div>
  );
}

function LoadingTitleSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-10 w-[min(70vw,18rem)] animate-pulse rounded-md bg-white/15 md:h-16 md:w-[min(70vw,30rem)]"
    />
  );
}

function LoadingBackdrop(props: { src?: string; alt: string }) {
  if (!props.src) {
    return <div className="absolute inset-0 bg-background-main" />;
  }

  return (
    <div className="absolute inset-0 overflow-hidden">
      <LazyImage
        src={props.src}
        alt={props.alt}
        className="absolute inset-0 h-full w-full object-cover"
        showSkeleton={false}
        loading="eager"
        decoding="sync"
      />
    </div>
  );
}

export interface PlayerLoadingOverlayViewProps {
  show: boolean;
  progress: number;
  title?: string;
  logo?: string;
  backdrop?: string;
  showBackdrop?: boolean;
  message?: string;
  className?: string;
}

export function PlayerLoadingOverlayView(props: PlayerLoadingOverlayViewProps) {
  const { t } = useTranslation();
  const loadingMessages = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) =>
        t(`player.loadingOverlayMessages.${i + 1}`),
      ).filter(Boolean),
    [t],
  );
  const backgroundImage = props.backdrop;
  const showBackdropImage = props.show && props.showBackdrop === true;
  const [shouldRender, setShouldRender] = useState(props.show);
  const [isVisible, setIsVisible] = useState(props.show);
  const [hideLogo, setHideLogo] = useState(false);
  const [assetsReady, setAssetsReady] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(() =>
    getRandomMessage(loadingMessages),
  );
  const [messageEnabled, setMessageEnabled] = useState(false);
  const [messageVisible, setMessageVisible] = useState(true);
  const hasMessageOverride = Boolean(props.message);

  useEffect(() => {
    setHideLogo(false);
  }, [props.logo]);

  useEffect(() => {
    let cancelled = false;

    if (!props.show) {
      setAssetsReady(false);
      return () => {
        cancelled = true;
      };
    }

    const sources = [
      showBackdropImage ? backgroundImage : null,
      props.logo,
    ].filter(Boolean) as string[];
    if (sources.length === 0) {
      setAssetsReady(true);
      return () => {
        cancelled = true;
      };
    }

    Promise.all(sources.map(preloadImage)).then(() => {
      if (!cancelled) setAssetsReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [props.show, showBackdropImage, backgroundImage, props.logo]);

  const showOverlayWhenReady = props.show && assetsReady;

  useEffect(() => {
    setLoadingMessage((prev) => getRandomMessage(loadingMessages, prev));
  }, [loadingMessages]);

  useEffect(() => {
    if (showOverlayWhenReady) {
      setLoadingMessage((prev) => getRandomMessage(loadingMessages, prev));
      setShouldRender(true);
      const frame = window.requestAnimationFrame(() => setIsVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }

    setIsVisible(false);
    const timeout = window.setTimeout(() => {
      setShouldRender(false);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [showOverlayWhenReady, loadingMessages]);

  useEffect(() => {
    if (!showOverlayWhenReady || hasMessageOverride) {
      setMessageEnabled(false);
      setMessageVisible(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setMessageEnabled(true);
      setMessageVisible(true);
    }, MESSAGE_INITIAL_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [showOverlayWhenReady, hasMessageOverride]);

  useEffect(() => {
    if (!showOverlayWhenReady || hasMessageOverride || !messageEnabled) {
      return;
    }

    const interval = window.setInterval(() => {
      setMessageVisible(false);
      window.setTimeout(() => {
        setLoadingMessage((prev) => getRandomMessage(loadingMessages, prev));
        setMessageVisible(true);
      }, 260);
    }, MESSAGE_INITIAL_DELAY_MS);

    return () => window.clearInterval(interval);
  }, [
    showOverlayWhenReady,
    loadingMessages,
    messageEnabled,
    hasMessageOverride,
  ]);

  if (!shouldRender && !props.show) return null;

  const displayTitle = props.title;
  const showLogo = Boolean(props.logo && !hideLogo);
  const message = props.message ?? loadingMessage;
  const messageVisibleNow =
    hasMessageOverride || (messageEnabled && messageVisible);

  return (
    <div
      className={`absolute inset-0 z-0 pointer-events-none overflow-hidden transition-opacity duration-300 ${
        isVisible || !showOverlayWhenReady ? "opacity-100" : "opacity-0"
      } ${props.className ?? ""}`}
    >
      {showBackdropImage ? (
        <LoadingBackdrop src={backgroundImage} alt={displayTitle ?? ""} />
      ) : null}

      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/5 to-black/45" />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center">
        {displayTitle ? (
          showLogo ? (
            <LoadingTitle
              logo={props.logo}
              title={displayTitle}
              progress={props.progress}
              onError={() => setHideLogo(true)}
            />
          ) : (
            <LoadingTitle
              title={displayTitle}
              progress={props.progress}
              onError={() => setHideLogo(true)}
            />
          )
        ) : (
          <LoadingTitleSkeleton />
        )}
        <p
          className={`text-[16px] text-white/60 font-medium transition-all duration-300 ${
            messageVisibleNow
              ? "opacity-100 translate-y-0"
              : "opacity-0 -translate-y-2"
          }`}
        >
          {message}
        </p>
      </div>
    </div>
  );
}

export function PlayerLoadingOverlay(props: { sourceLoading?: boolean }) {
  const status = usePlayerStore((s) => s.status);
  const meta = usePlayerStore((s) => s.meta);
  const sourceId = usePlayerStore((s) => s.sourceId);
  const embedId = usePlayerStore((s) => s.embedId);
  const hasRenderedFrame = usePlayerStore(
    (s) => s.mediaPlaying.hasRenderedFrame,
  );
  const isLoading = usePlayerStore((s) => s.mediaPlaying.isLoading);
  const time = usePlayerStore((s) => s.progress.time);
  const buffered = usePlayerStore((s) => s.progress.buffered);
  const duration = usePlayerStore((s) => s.progress.duration);
  const pictureInPictureMode = usePlayerStore(
    (s) => s.interface.pictureInPictureMode,
  );
  const torrentStatus = useActiveTorrentStatus();

  const isDesktopPipPlayback = pictureInPictureMode === "desktop";
  const loadingState = getPlayerLoadingOverlayState({
    status,
    sourceLoading: props.sourceLoading,
    isLoading,
    hasRenderedFrame,
    duration,
    buffered,
    torrentStatus,
    isDesktopPipPlayback,
  });

  const metaType = meta?.type;
  const metaTmdbId = meta?.tmdbId;
  const metaSeasonTmdbId = meta?.season?.tmdbId;
  const metaEpisodeTmdbId = meta?.episode?.tmdbId;

  const playbackKey = useMemo(() => {
    if (!metaType || !metaTmdbId) return null;
    const episodeKey =
      metaType === "show"
        ? `${metaSeasonTmdbId ?? ""}:${metaEpisodeTmdbId ?? ""}`
        : "";
    return [
      metaType,
      metaTmdbId,
      episodeKey,
      sourceId ?? "",
      embedId ?? "",
    ].join("|");
  }, [
    metaType,
    metaTmdbId,
    metaSeasonTmdbId,
    metaEpisodeTmdbId,
    sourceId,
    embedId,
  ]);

  const [canHidePlaybackOverlay, setCanHidePlaybackOverlay] = useState(false);
  const isPlaybackReady =
    status === playerStatus.PLAYING && hasRenderedFrame && !isLoading;

  useEffect(() => {
    if (!isPlaybackReady) {
      setCanHidePlaybackOverlay(false);
      return;
    }

    // Let the native surface swap and audio pipeline settle before hiding the
    // cover. Progress reaching 100% is not a readiness signal.
    const timeout = window.setTimeout(() => {
      setCanHidePlaybackOverlay(true);
    }, 140);

    return () => window.clearTimeout(timeout);
  }, [isPlaybackReady, playbackKey]);

  const showOverlay =
    loadingState.showOverlay ||
    (!isDesktopPipPlayback &&
      status === playerStatus.PLAYING &&
      !canHidePlaybackOverlay);
  const loadingProgress = canHidePlaybackOverlay
    ? 100
    : loadingState.loadingProgress;

  const lastPlaybackKeyRef = useRef<string | null>(null);
  const [initialLoadPlaybackKey, setInitialLoadPlaybackKey] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!playbackKey) {
      lastPlaybackKeyRef.current = null;
      setInitialLoadPlaybackKey(null);
      return;
    }
    if (lastPlaybackKeyRef.current !== playbackKey) {
      lastPlaybackKeyRef.current = playbackKey;
      setInitialLoadPlaybackKey(playbackKey);
    }
  }, [playbackKey]);

  useEffect(() => {
    if (
      initialLoadPlaybackKey &&
      playbackKey === initialLoadPlaybackKey &&
      status === playerStatus.PLAYING &&
      !showOverlay &&
      duration > 0 &&
      time > 0
    ) {
      setInitialLoadPlaybackKey(null);
    }
  }, [
    initialLoadPlaybackKey,
    playbackKey,
    status,
    showOverlay,
    duration,
    time,
  ]);

  const showBackdropImage =
    showOverlay &&
    (status === playerStatus.IDLE ||
      loadingState.isPreparingSource ||
      (status === playerStatus.PLAYING && !hasRenderedFrame) ||
      (playbackKey !== null && initialLoadPlaybackKey === playbackKey));
  return (
    <PlayerLoadingOverlayView
      show={showOverlay}
      progress={loadingProgress}
      title={meta?.title}
      logo={meta?.logo}
      backdrop={meta?.backdrop ?? meta?.poster}
      showBackdrop={showBackdropImage}
    />
  );
}
