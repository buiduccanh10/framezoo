import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { getIMDbMetadata } from "@/backend/metadata/imdb";
import { getMediaVideos } from "@/backend/metadata/tmdb";
import { TMDBContentTypes, TMDBVideo } from "@/backend/metadata/types/tmdb";
import { fetchCachedTmdb } from "@/utils/tmdbQuery";

interface TrailerPlayerProps {
  tmdbId: string;
  tmdbType: "movie" | "show";
  initialImdbId?: string;
  isActive: boolean;
  isMuted: boolean;
  onPlay?: () => void;
  onError?: () => void;
}

export interface TrailerPlayerHandle {
  setMuted: (muted: boolean) => void;
}

type TrailerSource =
  | {
      type: "youtube";
      video: TMDBVideo;
    }
  | {
      type: "imdb";
      url: string;
    };

type YouTubePlayer = {
  destroy?: () => void;
  mute?: () => void;
  unMute?: () => void;
  setVolume?: (volume: number) => void;
  playVideo?: () => void;
  isMuted?: () => boolean;
};

type YouTubePlayerEvent = {
  target: YouTubePlayer;
  data: number;
};

type YouTubeApi = {
  Player: new (
    element: HTMLElement,
    options: {
      width?: string;
      height?: string;
      videoId: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: (event: YouTubePlayerEvent) => void;
        onStateChange: (event: YouTubePlayerEvent) => void;
        onError: () => void;
      };
    },
  ) => YouTubePlayer;
  PlayerState: {
    PLAYING: number;
  };
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const TRAILER_READY_TIMEOUT_MS = 12_000;
const YOUTUBE_CROP_SCALE = 1.18;
let youtubeApiPromise: Promise<YouTubeApi> | null = null;

function applyYouTubeAudioState(player: YouTubePlayer, muted: boolean): void {
  if (muted) {
    player.mute?.();
  } else {
    player.unMute?.();
    player.setVolume?.(100);
    // Some iframe loads retain the muted state for one command cycle.
    if (player.isMuted?.()) {
      player.unMute?.();
    }
  }
}

function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youtubeApiPromise) {
    return youtubeApiPromise;
  }

  youtubeApiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const existingScript = document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    const previousReadyHandler = window.onYouTubeIframeAPIReady;

    const cleanup = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      window.onYouTubeIframeAPIReady = previousReadyHandler;
    };

    window.onYouTubeIframeAPIReady = () => {
      previousReadyHandler?.();
      if (window.YT?.Player) {
        cleanup();
        resolve(window.YT);
      } else {
        cleanup();
        reject(new Error("YouTube IFrame API unavailable"));
      }
    };

    if (!existingScript) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        cleanup();
        reject(new Error("Failed to load YouTube IFrame API"));
      };
      document.head.appendChild(script);
    }

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("YouTube IFrame API timed out"));
    }, TRAILER_READY_TIMEOUT_MS);
  }).catch((error) => {
    youtubeApiPromise = null;
    throw error;
  });

  return youtubeApiPromise;
}

function getBestOfficialYouTubeTrailer(
  videos: TMDBVideo[],
): TMDBVideo | undefined {
  return videos
    .filter(
      (video) =>
        video.site === "YouTube" &&
        video.type === "Trailer" &&
        video.official === true &&
        Boolean(video.key),
    )
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0];
}

interface YouTubeTrailerProps {
  videoId: string;
  isMuted: boolean;
  onPlay: () => void;
  onError: () => void;
  onAudioControllerChange: (
    controller: ((muted: boolean) => void) | null,
  ) => void;
}

function YouTubeTrailer({
  videoId,
  isMuted,
  onPlay,
  onError,
  onAudioControllerChange,
}: YouTubeTrailerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | undefined>(undefined);
  const playerReadyRef = useRef(false);
  const playerStartedRef = useRef(false);
  const audioSyncTimeoutsRef = useRef<number[]>([]);
  const scheduleAudioSyncRef = useRef<(() => void) | null>(null);
  const isMutedRef = useRef(isMuted);
  const onPlayRef = useRef(onPlay);
  const onErrorRef = useRef(onError);

  isMutedRef.current = isMuted;
  onPlayRef.current = onPlay;
  onErrorRef.current = onError;

  const setPlayerMuted = useCallback((muted: boolean) => {
    isMutedRef.current = muted;
    const player = playerRef.current;
    if (!player || !playerReadyRef.current || !playerStartedRef.current) {
      return;
    }
    applyYouTubeAudioState(player, muted);
    scheduleAudioSyncRef.current?.();
  }, []);

  useEffect(() => {
    onAudioControllerChange(setPlayerMuted);
    return () => onAudioControllerChange(null);
  }, [onAudioControllerChange, setPlayerMuted]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    setPlayerMuted(isMuted);
  }, [isMuted, setPlayerMuted]);

  useEffect(() => {
    let isCancelled = false;
    let player: YouTubePlayer | undefined;
    let readyTimeoutId: number | undefined;

    const scheduleAudioSync = (target: YouTubePlayer) => {
      if (!playerStartedRef.current) return;
      audioSyncTimeoutsRef.current.forEach((timeoutId) =>
        window.clearTimeout(timeoutId),
      );
      audioSyncTimeoutsRef.current = [
        0, 50, 150, 300, 600, 1200, 2500, 5000,
      ].map((delay) =>
        window.setTimeout(() => {
          if (!isCancelled) {
            applyYouTubeAudioState(target, isMutedRef.current);
          }
        }, delay),
      );
    };
    scheduleAudioSyncRef.current = () => {
      const currentPlayer = playerRef.current;
      if (
        !isCancelled &&
        currentPlayer &&
        playerReadyRef.current &&
        playerStartedRef.current
      ) {
        scheduleAudioSync(currentPlayer);
      }
    };

    const handleError = () => {
      if (isCancelled) return;
      if (readyTimeoutId) window.clearTimeout(readyTimeoutId);
      onErrorRef.current();
    };

    void loadYouTubeApi()
      .then((youtube) => {
        if (isCancelled || !containerRef.current) return;

        player = new youtube.Player(containerRef.current, {
          width: "100%",
          height: "100%",
          videoId,
          playerVars: {
            autoplay: 1,
            cc_load_policy: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            loop: 1,
            modestbranding: 1,
            playsinline: 1,
            playlist: videoId,
            rel: 0,
            vq: "hd2160",
          },
          events: {
            onReady: ({ target }) => {
              playerReadyRef.current = true;
              playerStartedRef.current = false;
              // Start muted. Unmute only after YouTube reports PLAYING.
              applyYouTubeAudioState(target, true);
              const iframe =
                containerRef.current?.querySelector<HTMLIFrameElement>(
                  "iframe",
                );
              iframe?.setAttribute(
                "allow",
                "autoplay; encrypted-media; picture-in-picture",
              );
              target.playVideo?.();
            },
            onStateChange: ({ target, data }) => {
              if (data === youtube.PlayerState.PLAYING) {
                if (readyTimeoutId) window.clearTimeout(readyTimeoutId);
                playerReadyRef.current = true;
                playerStartedRef.current = true;
                applyYouTubeAudioState(target, isMutedRef.current);
                scheduleAudioSync(target);
                onPlayRef.current();
              }
            },
            onError: handleError,
          },
        });
        playerRef.current = player;

        readyTimeoutId = window.setTimeout(
          handleError,
          TRAILER_READY_TIMEOUT_MS,
        );
      })
      .catch(handleError);

    return () => {
      isCancelled = true;
      playerReadyRef.current = false;
      playerStartedRef.current = false;
      scheduleAudioSyncRef.current = null;
      if (readyTimeoutId) window.clearTimeout(readyTimeoutId);
      audioSyncTimeoutsRef.current.forEach((timeoutId) =>
        window.clearTimeout(timeoutId),
      );
      audioSyncTimeoutsRef.current = [];
      player?.destroy?.();
      playerRef.current = undefined;
    };
  }, [videoId]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{
          transform: `scale(${YOUTUBE_CROP_SCALE})`,
          transformOrigin: "center",
        }}
      />
    </div>
  );
}

export const TrailerPlayer = forwardRef<
  TrailerPlayerHandle,
  TrailerPlayerProps
>(function TrailerPlayerComponent(
  { tmdbId, tmdbType, initialImdbId, isActive, isMuted, onPlay, onError },
  ref,
) {
  const [isReady, setIsReady] = useState(false);
  const [shouldRender, setShouldRender] = useState(isActive);
  const [source, setSource] = useState<TrailerSource | null>(null);
  const [isResolvingFallback, setIsResolvingFallback] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const sourceErrorHandledRef = useRef(false);
  const isReadyRef = useRef(false);
  const onErrorRef = useRef(onError);
  const isActiveRef = useRef(isActive);
  const isResolvingFallbackRef = useRef(false);
  const fallbackAttemptRef = useRef(0);
  const sourceRef = useRef(source);
  const audioControllerRef = useRef<((muted: boolean) => void) | null>(null);

  onErrorRef.current = onError;
  isActiveRef.current = isActive;
  sourceRef.current = source;

  const handleAudioControllerChange = useCallback(
    (controller: ((muted: boolean) => void) | null) => {
      audioControllerRef.current = controller;
    },
    [],
  );

  const setMuted = useCallback((muted: boolean) => {
    audioControllerRef.current?.(muted);
  }, []);

  useImperativeHandle(ref, () => ({ setMuted }), [setMuted]);

  useEffect(() => {
    audioControllerRef.current?.(isMuted);
  }, [isMuted]);

  const handleTrailerFailure = useCallback((attemptId?: number) => {
    if (attemptId && attemptId !== fallbackAttemptRef.current) return;
    setIsReady(false);
    isReadyRef.current = false;
    setSource(null);
    setHasFailed(true);
    onErrorRef.current?.();
  }, []);

  const resolveIMDbTrailer = useCallback(
    async (isCancelled: boolean) => {
      if (
        isCancelled ||
        isResolvingFallbackRef.current ||
        !isActiveRef.current
      ) {
        return;
      }

      const attemptId = ++fallbackAttemptRef.current;
      isResolvingFallbackRef.current = true;
      setIsResolvingFallback(true);

      try {
        let imdbId = initialImdbId;

        if (!imdbId) {
          const externalIds = await fetchCachedTmdb<any>(
            `/${tmdbType === "movie" ? "movie" : "tv"}/${tmdbId}/external_ids`,
          );
          if (
            isCancelled ||
            attemptId !== fallbackAttemptRef.current ||
            !isActiveRef.current
          ) {
            return;
          }
          imdbId = externalIds?.imdb_id;
        }

        if (!imdbId) {
          handleTrailerFailure(attemptId);
          return;
        }

        const metadata = await getIMDbMetadata(imdbId);
        if (
          isCancelled ||
          attemptId !== fallbackAttemptRef.current ||
          !isActiveRef.current
        ) {
          return;
        }

        if (metadata?.trailer_url) {
          setSource({ type: "imdb", url: metadata.trailer_url });
        } else {
          handleTrailerFailure(attemptId);
        }
      } catch (error) {
        if (
          !isCancelled &&
          attemptId === fallbackAttemptRef.current &&
          isActiveRef.current
        ) {
          console.error("Failed to fetch IMDb trailer:", error);
          handleTrailerFailure(attemptId);
        }
      } finally {
        if (attemptId === fallbackAttemptRef.current) {
          isResolvingFallbackRef.current = false;
          if (!isCancelled && isActiveRef.current) {
            setIsResolvingFallback(false);
          }
        }
      }
    },
    [initialImdbId, tmdbId, tmdbType, handleTrailerFailure],
  );

  const handleSourceError = useCallback(() => {
    if (sourceErrorHandledRef.current) return;
    sourceErrorHandledRef.current = true;
    setIsReady(false);
    isReadyRef.current = false;

    if (sourceRef.current?.type === "youtube") {
      onErrorRef.current?.();
      void resolveIMDbTrailer(false);
    } else {
      handleTrailerFailure();
    }
  }, [handleTrailerFailure, resolveIMDbTrailer]);

  function handleSourcePlay() {
    setIsReady(true);
    isReadyRef.current = true;
    onPlay?.();
  }

  useEffect(() => {
    let isCancelled = false;

    if (isActive) {
      setShouldRender(true);

      if (source || hasFailed) return;

      const fetchTrailer = async () => {
        try {
          const videos = await getMediaVideos(
            tmdbId,
            tmdbType === "movie" ? TMDBContentTypes.MOVIE : TMDBContentTypes.TV,
          );
          const youtubeTrailer = getBestOfficialYouTubeTrailer(videos);

          if (youtubeTrailer) {
            if (!isCancelled) {
              setSource({ type: "youtube", video: youtubeTrailer });
            }
            return;
          }
        } catch (error) {
          console.error("Failed to fetch YouTube trailer metadata:", error);
        }

        await resolveIMDbTrailer(isCancelled);
      };

      void fetchTrailer();
    } else {
      // Destroy inactive trailers immediately. Keeping the previous iframe
      // alive while the next slide starts can steal the audio state.
      setShouldRender(false);
      setIsReady(false);
      setSource(null);
      setHasFailed(false);
      isResolvingFallbackRef.current = false;
      setIsResolvingFallback(false);
      fallbackAttemptRef.current += 1;
    }

    return () => {
      isCancelled = true;
    };
  }, [
    hasFailed,
    initialImdbId,
    isActive,
    resolveIMDbTrailer,
    source,
    tmdbId,
    tmdbType,
  ]);

  useEffect(() => {
    if (!isActive || !source) return;

    setIsReady(false);
    isReadyRef.current = false;
    sourceErrorHandledRef.current = false;

    const timeoutId = window.setTimeout(() => {
      if (!isReadyRef.current) {
        handleSourceError();
      }
    }, TRAILER_READY_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [handleSourceError, isActive, source]);

  if (!shouldRender || !source || isResolvingFallback) return null;

  return (
    <div
      className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none"
      style={{
        maskImage:
          "linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 1) 700px)",
        WebkitMaskImage:
          "linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 1) 700px)",
        opacity: isReady && isActive ? 1 : 0,
        transition: "opacity 0.8s ease",
        zIndex: isActive ? 10 : 5,
      }}
    >
      {source.type === "youtube" ? (
        <YouTubeTrailer
          key={source.video.key}
          videoId={source.video.key}
          isMuted={isMuted}
          onPlay={handleSourcePlay}
          onError={handleSourceError}
          onAudioControllerChange={handleAudioControllerChange}
        />
      ) : (
        <video
          src={source.url}
          autoPlay
          muted
          loop
          playsInline
          ref={(video) => {
            if (video) {
              video.volume = 1;
              video.muted = true;
              audioControllerRef.current = (muted) => {
                video.muted = muted;
                video.volume = 1;
              };
            } else {
              audioControllerRef.current = null;
            }
          }}
          onLoadedMetadata={(event) => {
            event.currentTarget.volume = 1;
            event.currentTarget.muted = true;
          }}
          onCanPlay={(event) => {
            const video = event.currentTarget;
            video.volume = 1;
            video.muted = true;
            void video.play().catch(() => undefined);
            handleSourcePlay();
          }}
          onPlaying={(event) => {
            const video = event.currentTarget;
            video.volume = 1;
            video.muted = isMuted;
          }}
          onError={handleSourceError}
          className="h-full w-full object-cover object-center pointer-events-none"
        />
      )}
    </div>
  );
});
