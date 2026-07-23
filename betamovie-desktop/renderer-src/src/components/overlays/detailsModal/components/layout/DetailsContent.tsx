import { t } from "i18next";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCopyToClipboard, useIntersection } from "react-use";

import { getIMDbMetadata } from "@/backend/metadata/imdb";
import { getRottenTomatoesMetadata } from "@/backend/metadata/rottenTomatoes";
import { TMDBIdToUrlId, getSeasonDetails } from "@/backend/metadata/tmdb";
import { getNetworkContent } from "@/backend/metadata/traktApi";
import { MWMediaType } from "@/backend/metadata/types/mw";
import { TMDBContentTypes } from "@/backend/metadata/types/tmdb";
import { Icon, Icons } from "@/components/Icon";
import { conf } from "@/setup/config";
import { useLanguageStore } from "@/stores/language";
import {
  PlayerMeta,
  PlayerNavigationState,
} from "@/stores/player/slices/source";
import { getProgressPercentage, useProgressStore } from "@/stores/progress";
import { shouldShowProgress } from "@/stores/progress/utils";
import { getTmdbLanguageCode } from "@/utils/language";

import {
  DetailsContentProps,
  DetailsIMDbData,
  DetailsRTData,
} from "../../types";
import { EpisodeCarousel } from "../carousels/EpisodeCarousel";
import { CastCarousel } from "../carousels/PeopleCarousel";
import { SimilarMediaCarousel } from "../carousels/SimilarMediaCarousel";
import { TrailerCarousel } from "../carousels/TrailerCarousel";
import { CollectionOverlay } from "../overlays/CollectionOverlay";
import { TrailerOverlay } from "../overlays/TrailerOverlay";
import { DetailsBackdrop } from "../sections/DetailsBackdrop";
import { DetailsBody } from "../sections/DetailsBody";
import { DetailsInfo } from "../sections/DetailsInfo";

export function LazyCarouselWrapper({
  children,
  skeleton,
  isLoading = false,
  keepChildrenMounted = false,
}: {
  children: ReactNode;
  skeleton: ReactNode;
  isLoading?: boolean;
  keepChildrenMounted?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const intersection = useIntersection(ref, {
    root: null,
    rootMargin: "500px",
    threshold: 0,
  });
  const [hasRendered, setHasRendered] = useState(false);

  useEffect(() => {
    if (intersection?.isIntersecting) {
      setHasRendered(true);
    }
  }, [intersection]);

  return (
    <div ref={ref} className="min-h-[200px]">
      {!hasRendered ? (
        skeleton
      ) : isLoading && !keepChildrenMounted ? (
        skeleton
      ) : (
        <>
          {children}
          {isLoading && keepChildrenMounted ? skeleton : null}
        </>
      )}
    </div>
  );
}

type CarouselSkeletonVariant = "episodes" | "cast" | "trailers" | "similar";
type DetailsEpisode = {
  id: number;
  name: string;
  overview: string;
  episode_number: number;
  season_number: number;
  still_path: string | null;
  air_date: string;
};

function CarouselSkeleton({ variant }: { variant: CarouselSkeletonVariant }) {
  if (variant === "episodes") {
    return (
      <div
        className="mt-6 space-y-4 animate-pulse"
        aria-hidden="true"
        data-testid="details-episodes-skeleton"
      >
        <div className="flex items-center gap-3">
          <div className="h-6 w-28 rounded bg-white/10" />
          <div className="h-5 w-20 rounded bg-white/10" />
          <div className="ml-auto h-9 w-28 rounded-lg bg-white/10" />
        </div>
        <div className="flex gap-4 overflow-hidden pb-4 lg:px-12">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="w-64 flex-shrink-0 space-y-3">
              <div className="h-[158px] w-full rounded-xl bg-white/10" />
              <div className="h-4 w-3/4 rounded bg-white/10" />
              <div className="h-3 w-1/2 rounded bg-white/10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "cast") {
    return (
      <div
        className="space-y-4 pt-8 animate-pulse"
        aria-hidden="true"
        data-testid="details-cast-skeleton"
      >
        <div className="flex gap-4 overflow-hidden pb-4">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="w-32 flex-shrink-0 space-y-2">
              <div className="h-32 w-32 rounded-full bg-white/10" />
              <div className="mx-auto h-4 w-24 rounded bg-white/10" />
              <div className="mx-auto h-3 w-16 rounded bg-white/10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "trailers") {
    return (
      <div
        className="space-y-4 pt-8 animate-pulse"
        aria-hidden="true"
        data-testid="details-trailers-skeleton"
      >
        <div className="h-6 w-32 rounded bg-white/10" />
        <div className="flex gap-4 overflow-hidden pb-4">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="h-52 w-96 flex-shrink-0 rounded-lg bg-white/10"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="space-y-4 pt-8 animate-pulse"
      aria-hidden="true"
      data-testid="details-similar-skeleton"
    >
      <div className="h-6 w-32 rounded bg-white/10" />
      <div className="flex gap-4 overflow-hidden pb-4">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="w-40 flex-shrink-0 space-y-3 md:w-[11.5rem]"
          >
            <div className="aspect-[2/3] rounded-xl bg-white/10" />
            <div className="h-4 w-full rounded bg-white/10" />
            <div className="h-3 w-2/3 rounded bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}

function buildPlayerMeta(
  data: DetailsContentProps["data"],
  showProgress: ReturnType<typeof shouldShowProgress> | null,
  selectedSeason: number,
  fetchedSeasons: Record<number, DetailsEpisode[]>,
): PlayerMeta | null {
  if (
    !data.id ||
    !data.title ||
    (data.type !== "movie" && data.type !== "show")
  ) {
    return null;
  }

  const baseMeta = {
    title: data.title,
    releaseYear: data.releaseDate
      ? new Date(data.releaseDate).getFullYear()
      : 0,
    poster: data.posterUrl,
    backdrop: data.backdrop,
    logo: data.logoUrl,
    tmdbId: data.id.toString(),
    imdbId: data.imdbId,
    overview: data.overview,
  };

  if (data.type === "movie") {
    return {
      type: "movie",
      ...baseMeta,
    };
  }

  const seasonNumber = showProgress?.season?.number ?? selectedSeason;
  const seasonInfo = data.seasonData?.seasons.find(
    (season) => season.season_number === seasonNumber,
  );
  const seasonEpisodes =
    fetchedSeasons[seasonNumber] ?? data.seasonData?.episodes ?? [];
  const progressEpisode = showProgress?.episode;
  const selectedEpisode =
    seasonEpisodes.find(
      (episode) => episode.id.toString() === progressEpisode?.id,
    ) ??
    seasonEpisodes[0] ??
    (progressEpisode
      ? {
          id: Number(progressEpisode.id),
          name: progressEpisode.title,
          episode_number: progressEpisode.number,
          overview: "",
          still_path: null,
          air_date: "",
          season_number: seasonNumber,
        }
      : null);
  const seasonId = showProgress?.season?.id ?? seasonInfo?.id.toString();

  if (!selectedEpisode || !seasonId) return null;

  const episodes =
    seasonEpisodes.length > 0 ? seasonEpisodes : [selectedEpisode];
  const toPlayerEpisode = (episode: DetailsEpisode) => ({
    number: episode.episode_number,
    title: episode.name,
    tmdbId: episode.id.toString(),
    air_date: episode.air_date,
    overview: episode.overview,
  });

  return {
    type: "show",
    ...baseMeta,
    episodes: episodes.map(toPlayerEpisode),
    episode: toPlayerEpisode(selectedEpisode),
    season: {
      number: seasonNumber,
      title: showProgress?.season?.title ?? seasonInfo?.name ?? "",
      tmdbId: seasonId,
    },
  };
}

export function DetailsContent({ data, minimal = false }: DetailsContentProps) {
  const navigate = useNavigate();
  const [imdbData, setImdbData] = useState<DetailsIMDbData | null>(null);
  const [rtData, setRtData] = useState<DetailsRTData | null>(null);
  const [providerData, setProviderData] = useState<string | undefined>(
    undefined,
  );
  const [isLoadingImdb, setIsLoadingImdb] = useState(false);
  const [isLoadingRt, setIsLoadingRt] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);
  const [showCollection, setShowCollection] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [fetchedSeasons, setFetchedSeasons] = useState<
    Record<number, DetailsEpisode[]>
  >({});
  const [loadingSeasons, setLoadingSeasons] = useState<Record<number, boolean>>(
    {},
  );
  const [isLoadingCast, setIsLoadingCast] = useState(false);
  const [isLoadingTrailers, setIsLoadingTrailers] = useState(false);
  const [, copyToClipboard] = useCopyToClipboard();
  const [hasCopiedShare, setHasCopiedShare] = useState(false);
  const progress = useProgressStore((s) => s.items);
  const updateItem = useProgressStore((s) => s.updateItem);

  // Check if movie is watched (>90% progress)
  const isMovieWatched = useMemo(() => {
    if (data.type !== "movie" || !data.id) return false;
    const movieProgress = progress[data.id.toString()]?.progress;
    if (!movieProgress) return false;
    const percentage = getProgressPercentage(
      movieProgress.watched,
      movieProgress.duration,
    );
    return percentage > 90;
  }, [data.type, data.id, progress]);

  const showProgress = useMemo(() => {
    if (!data.id) return null;
    const item = progress[data.id.toString()];
    if (!item) return null;
    return shouldShowProgress(item);
  }, [data.id, progress]);

  // Set initial season based on current episode
  useEffect(() => {
    if (showProgress?.season?.number) {
      setSelectedSeason(showProgress.season.number);
    }
  }, [showProgress]);

  // Fetch episodes for selected season
  useEffect(() => {
    const fetchSeason = async (seasonNumber: number) => {
      if (
        !data.id ||
        seasonNumber === -1 ||
        fetchedSeasons[seasonNumber] ||
        loadingSeasons[seasonNumber]
      )
        return;

      setLoadingSeasons((prev) => ({ ...prev, [seasonNumber]: true }));
      try {
        const episodes = await getSeasonDetails(
          data.id.toString(),
          seasonNumber,
        );
        setFetchedSeasons((prev) => ({ ...prev, [seasonNumber]: episodes }));
      } catch (err) {
        console.error("Failed to fetch season details:", err);
      } finally {
        setLoadingSeasons((prev) => ({ ...prev, [seasonNumber]: false }));
      }
    };

    if (data.type === "show" && selectedSeason !== -1) {
      fetchSeason(selectedSeason);
    }
  }, [
    data.id,
    data.type,
    selectedSeason,
    fetchedSeasons,
    loadingSeasons,
    data.seasonData,
  ]);

  const allEpisodes = useMemo(() => {
    return Object.values(fetchedSeasons).flat();
  }, [fetchedSeasons]);
  const isLoadingSelectedSeason =
    data.type === "show" && Boolean(loadingSeasons[selectedSeason]);

  useEffect(() => {
    let isCancelled = false;

    const fetchNetworkData = async () => {
      if (!conf().USE_TRAKT || !data.id || !data.type) {
        setProviderData(undefined);
        return;
      }

      try {
        const networkData = await getNetworkContent(
          data.id.toString(),
          data.type,
        );
        if (
          !isCancelled &&
          networkData &&
          networkData.platforms &&
          networkData.platforms.length > 0
        ) {
          setProviderData(networkData.platforms[0]);
        } else if (!isCancelled) {
          setProviderData(undefined);
        }
      } catch (error) {
        if (!isCancelled) {
          setProviderData(undefined);
        }
        console.error("Failed to fetch network data:", error);
      }
    };

    const timer = setTimeout(() => {
      void fetchNetworkData();
    }, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [data.id, data.type]);

  useEffect(() => {
    let isCancelled = false;

    const fetchImdbData = async () => {
      if (!data.imdbId) {
        setImdbData(null);
        setIsLoadingImdb(false);
        return;
      }

      setIsLoadingImdb(true);
      try {
        const userLanguage = useLanguageStore.getState().language;
        const formattedLanguage = getTmdbLanguageCode(userLanguage);
        const imdbMetadata = await getIMDbMetadata(
          data.imdbId,
          undefined,
          undefined,
          formattedLanguage,
        );

        if (isCancelled) return;

        if (
          imdbMetadata &&
          typeof imdbMetadata.imdb_rating === "number" &&
          typeof imdbMetadata.votes === "number"
        ) {
          setImdbData({
            rating: imdbMetadata.imdb_rating,
            votes: imdbMetadata.votes,
            trailer_url: imdbMetadata.trailer_url,
          });
        } else {
          setImdbData(null);
        }
      } catch (error) {
        if (!isCancelled) {
          setImdbData(null);
        }
        console.error("Failed to fetch IMDb data:", error);
      } finally {
        if (!isCancelled) {
          setIsLoadingImdb(false);
        }
      }
    };

    const fetchRtData = async () => {
      if (data.type !== "movie" && data.type !== "show") {
        setRtData(null);
        setIsLoadingRt(false);
        return;
      }

      setIsLoadingRt(true);
      try {
        const rtMetadata = await getRottenTomatoesMetadata(
          data.title,
          data.releaseDate
            ? new Date(data.releaseDate).getFullYear()
            : undefined,
        );

        if (!isCancelled) {
          setRtData(rtMetadata);
        }
      } catch (error) {
        if (!isCancelled) {
          setRtData(null);
        }
        console.error("Failed to fetch Rotten Tomatoes data:", error);
      } finally {
        if (!isCancelled) {
          setIsLoadingRt(false);
        }
      }
    };

    const timer = setTimeout(() => {
      void fetchImdbData();
      void fetchRtData();
    }, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [data.imdbId, data.title, data.releaseDate, data.type]);

  const handlePlayClick = () => {
    if (!data.id) return;

    const playerMeta = buildPlayerMeta(
      data,
      showProgress,
      selectedSeason,
      fetchedSeasons,
    );
    const navigationState: PlayerNavigationState | undefined = playerMeta
      ? { playerMeta }
      : undefined;

    if (data.type === "movie") {
      const urlId = TMDBIdToUrlId(
        MWMediaType.MOVIE,
        data.id.toString(),
        data.title,
      );
      navigate(`/media/${urlId}`, {
        state: navigationState,
      });
    } else if (data.type === "show") {
      const urlId = TMDBIdToUrlId(
        MWMediaType.SERIES,
        data.id.toString(),
        data.title,
      );
      if (showProgress?.season?.id && showProgress?.episode?.id) {
        navigate(
          `/media/${urlId}/${showProgress.season.id}/${showProgress.episode.id}`,
          {
            state: navigationState,
          },
        );
      } else {
        // Start new show
        navigate(`/media/${urlId}`, {
          state: navigationState,
        });
      }
    }
  };

  const handleShareClick = () => {
    if (!data.id) return;
    const urlId = TMDBIdToUrlId(
      data.type === "movie" ? MWMediaType.MOVIE : MWMediaType.SERIES,
      data.id.toString(),
      data.title,
    );
    const middlePart = conf().NORMAL_ROUTER ? "" : "/#";
    const shareUrl = `${window.location.origin}${middlePart}/discover?detail=${urlId}`;

    // Check if the device is iOS and share API is available
    if (/iPad|iPhone|iPod/i.test(navigator.userAgent) && navigator.share) {
      navigator
        .share({
          title: "AlphaFlix",
          text: data.title,
          url: shareUrl,
        })
        .catch((error) => console.error("Error sharing:", error));
    } else {
      // Fall back to clipboard copy for non-iOS devices
      copyToClipboard(shareUrl);
      setHasCopiedShare(true);
      setTimeout(() => setHasCopiedShare(false), 2000);
    }
  };

  const toggleMovieWatchStatus = () => {
    if (data.type !== "movie" || !data.id) return;

    // Get the poster URL from the data
    const posterUrl = data.posterUrl;

    // Update progress - if watched, set to 0%, otherwise set to 100% (completed)
    const shouldMarkWatched = !isMovieWatched;
    updateItem({
      meta: {
        tmdbId: data.id.toString(),
        title: data.title || "",
        type: "movie",
        releaseYear: data.releaseDate
          ? new Date(data.releaseDate).getFullYear()
          : new Date().getFullYear(),
        poster: posterUrl,
      },
      progress: {
        watched: shouldMarkWatched ? 60 : 0, // 60 seconds (100%) for watched, 0 for unwatched
        duration: 60,
      },
    });
  };

  return (
    <div className="relative h-full flex flex-col">
      {/* Share notification popup */}
      {hasCopiedShare && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 bg-green-600 text-white rounded-lg shadow-lg transition-all duration-300 animate-[scaleIn_0.6s_ease-out_forwards]">
          <div className="flex items-center gap-2">
            <Icon icon={Icons.CHECKMARK} className="text-white" />
            <span className="text-sm font-medium">
              Link copied to clipboard!
            </span>
          </div>
        </div>
      )}

      {/* Trailer Overlay */}
      {showTrailer && imdbData?.trailer_url && (
        <TrailerOverlay
          trailerUrl={imdbData.trailer_url}
          onClose={() => setShowTrailer(false)}
        />
      )}

      {/* Collection Overlay */}
      {showCollection && data.collection && (
        <CollectionOverlay
          collectionId={data.collection.id}
          collectionName={data.collection.name}
          onClose={() => setShowCollection(false)}
          onMovieClick={(movieId) => {
            setShowCollection(false);
            // Optionally navigate to the movie details
            navigate(`/media/tmdb-movie-${movieId}`);
          }}
        />
      )}

      {/* Backdrop */}
      <DetailsBackdrop
        title={data.title}
        logoUrl={data.logoUrl}
        backdrop={data.backdrop}
      />

      {/* Content */}
      <div
        ref={contentRef}
        className="px-6 pb-6 mt-[-70px] flex-grow relative z-30"
      >
        <DetailsBody
          data={data}
          onPlayClick={handlePlayClick}
          onShareClick={handleShareClick}
          showProgress={showProgress}
          voteAverage={data.voteAverage}
          voteCount={data.voteCount}
          releaseDate={data.releaseDate}
          seasons={data.type === "show" ? data.seasons : undefined}
          imdbData={imdbData}
          rtData={rtData}
          isLoadingImdb={isLoadingImdb}
          isLoadingRt={isLoadingRt}
        />

        {/* Two Column Layout - Stacked on Mobile */}
        <div className="grid grid-cols-1 md:grid-cols-3 md:gap-6 pt-4">
          {/* Left Column - Main Content (2/3) */}
          <div className="md:col-span-2">
            {/* Description */}
            {data.overview && (
              <p className="text-sm text-white/90 mb-6">{data.overview}</p>
            )}

            {/* Genres */}
            {data.genres && data.genres.length > 0 && (
              <div className="flex justify-between items-center">
                <div className="flex flex-wrap gap-2 items-center">
                  {data.genres.map((genre, index) => (
                    <span
                      key={genre.id}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-white/20 text-white/80 transition-all duration-300 hover:scale-110 animate-[scaleIn_0.6s_ease-out_forwards]"
                      style={{
                        animationDelay: `${((data.genres?.length ?? 0) - 1 - index) * 60}ms`,
                        transform: "scale(0)",
                        opacity: 0,
                      }}
                    >
                      {t(`tmdb.genres.${genre.id}`, {
                        defaultValue: genre.name,
                      })}
                    </span>
                  ))}
                </div>
                {/* Movie Watch Toggle Button - Only show for movies and not in minimal modal */}
                {data.type === "movie" && !minimal && (
                  <button
                    type="button"
                    onClick={toggleMovieWatchStatus}
                    className="p-1.5 bg-dropdown-background hover:bg-dropdown-hoverBackground transition-colors rounded-full ml-2"
                    title={
                      isMovieWatched
                        ? t("player.menus.episodes.markAsUnwatched")
                        : t("player.menus.episodes.markAsWatched")
                    }
                  >
                    <Icon
                      icon={isMovieWatched ? Icons.EYE_SLASH : Icons.EYE}
                      className="h-5 w-5 text-white"
                    />
                  </button>
                )}
              </div>
            )}

            {/* Director and Cast */}
            <div className="space-y-4 mb-6">
              {data.director && (
                <div className="text-xs">
                  <span className="font-medium text-white/80">
                    {t("details.director")}
                  </span>{" "}
                  <span className="text-white/70">{data.director}</span>
                </div>
              )}
              {data.actors && data.actors.length > 0 && (
                <div className="text-xs">
                  <span className="font-medium text-white/80">
                    {t("details.cast")}
                  </span>{" "}
                  <span className="text-white/70">
                    {data.actors.join(", ")}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Details Info (1/3) */}
          <div className="md:col-span-1">
            <DetailsInfo
              data={data}
              imdbData={imdbData}
              rtData={rtData}
              isLoadingImdb={isLoadingImdb}
              isLoadingRt={isLoadingRt}
              provider={providerData}
              onCollectionClick={() => setShowCollection(true)}
            />
          </div>
        </div>

        {/* Episodes Carousel for TV Shows */}
        {data.type === "show" && data.seasonData && !minimal && (
          <LazyCarouselWrapper
            isLoading={isLoadingSelectedSeason}
            skeleton={<CarouselSkeleton variant="episodes" />}
          >
            <EpisodeCarousel
              episodes={allEpisodes}
              showProgress={showProgress}
              progress={progress}
              selectedSeason={selectedSeason}
              onSeasonChange={setSelectedSeason}
              seasons={data.seasonData.seasons}
              mediaId={data.id}
              mediaTitle={data.title}
              mediaPosterUrl={data.posterUrl}
              totalEpisodes={data.episodes}
              boundaryRef={contentRef}
            />
          </LazyCarouselWrapper>
        )}

        {/* Cast Carousel */}
        {data.id && (
          <LazyCarouselWrapper
            isLoading={isLoadingCast}
            keepChildrenMounted
            skeleton={<CarouselSkeleton variant="cast" />}
          >
            <CastCarousel
              mediaId={data.id.toString()}
              mediaType={
                data.type === "movie"
                  ? TMDBContentTypes.MOVIE
                  : TMDBContentTypes.TV
              }
              onLoadingChange={setIsLoadingCast}
            />
          </LazyCarouselWrapper>
        )}

        {/* Trailer Carousel */}
        {data.id && (
          <LazyCarouselWrapper
            isLoading={isLoadingTrailers}
            keepChildrenMounted
            skeleton={<CarouselSkeleton variant="trailers" />}
          >
            <TrailerCarousel
              mediaId={data.id.toString()}
              mediaType={
                data.type === "movie"
                  ? TMDBContentTypes.MOVIE
                  : TMDBContentTypes.TV
              }
              imdbData={imdbData}
              onLoadingChange={setIsLoadingTrailers}
              onTrailerClick={(videoKey, isImdbTrailer) => {
                let trailerUrl: string;
                if (isImdbTrailer) {
                  // IMDb trailer is already a full URL
                  trailerUrl = videoKey;
                } else {
                  // TMDB trailer needs to be converted to YouTube embed URL
                  trailerUrl = `https://www.youtube.com/embed/${videoKey}?autoplay=1&rel=0`;
                }
                setShowTrailer(true);
                setImdbData((prev: any) => ({
                  ...prev,
                  trailer_url: trailerUrl,
                }));
              }}
            />
          </LazyCarouselWrapper>
        )}

        {/* Similar Media Carousel */}
        {data.id && (
          <LazyCarouselWrapper
            skeleton={<CarouselSkeleton variant="similar" />}
          >
            <SimilarMediaCarousel
              mediaId={data.id.toString()}
              mediaType={
                data.type === "movie"
                  ? TMDBContentTypes.MOVIE
                  : TMDBContentTypes.TV
              }
            />
          </LazyCarouselWrapper>
        )}
      </div>
    </div>
  );
}
