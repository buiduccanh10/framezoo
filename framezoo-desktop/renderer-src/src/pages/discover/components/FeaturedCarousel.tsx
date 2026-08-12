import { useIsRestoring } from "@tanstack/react-query";
import classNames from "classnames";
import { t } from "i18next";
import { ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWindowSize } from "react-use";

import { getIMDbMetadata } from "@/backend/metadata/imdb";
import { getRottenTomatoesMetadata } from "@/backend/metadata/rottenTomatoes";
import { TMDBIdToUrlId, getMediaLogo } from "@/backend/metadata/tmdb";
import { MWMediaType } from "@/backend/metadata/types/mw";
import {
  TMDBContentTypes,
  type TMDBMovieData,
} from "@/backend/metadata/types/tmdb";
import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import {
  ReleaseQualityBadge,
  type ReleaseQualityVariant,
  getReleaseQualityVariantFromTmdbReleaseDates,
} from "@/components/media/ReleaseQualityBadge";
import {
  TrailerPlayer,
  type TrailerPlayerHandle,
} from "@/components/TrailerPlayer";
import { LazyImage } from "@/components/utils/Image";
import { Movie, TVShow } from "@/pages/discover/common";
import { useLanguageStore } from "@/stores/language";
import { usePreferencesStore } from "@/stores/preferences";
import { getProgressPercentage, useProgressStore } from "@/stores/progress";
import { shouldShowProgress } from "@/stores/progress/utils";
import { getTmdbLanguageCode } from "@/utils/language";
import { getRTAudienceIcon, getRTIcon } from "@/utils/rottenTomatoes";
import { fetchCachedTmdb } from "@/utils/tmdbQuery";

import { RandomMovieButton } from "./RandomMovieButton";

export interface FeaturedMedia extends Partial<Movie & TVShow> {
  children?: ReactNode;
  backdrop_path?: string;
  overview: string;
  title?: string;
  name?: string;
  type: "movie" | "show";
  source?: "day" | "week";
  vote_average?: number;
  vote_count?: number;
  number_of_seasons?: number;
  imdb_rating?: number;
  imdb_votes?: number;
  external_ids?: {
    imdb_id?: string;
  };
  release_dates?: TMDBMovieData["release_dates"];
}

interface FeaturedCarouselProps {
  onShowDetails: (media: FeaturedMedia) => void;
  onInitialContentReady?: () => void;
  children?: ReactNode;
  searching?: boolean;
  shorter?: boolean;
}

interface FeaturedIMDbData {
  rating: number;
  votes: number;
}

interface FeaturedRTData {
  title: string;
  tomatoIcon: "certified_fresh" | "fresh" | "rotten";
  tomatoScore: number;
  popcornIcon?: "upright" | "spilled" | "empty";
  popcornScore?: number;
  url: string;
}

function selectFeaturedSlides(
  featured: FeaturedMedia[],
  limit: number,
): FeaturedMedia[] {
  const withImages = featured.filter((item) =>
    Boolean(getSlideImagePath(item)),
  );
  const source = withImages.length > 0 ? withImages : featured;

  return source.slice(0, limit);
}

function getSlideImagePath(item: FeaturedMedia): string | undefined {
  return item.backdrop_path || item.poster_path;
}

function shouldLoadSlideImage(
  index: number,
  currentIndex: number,
  totalSlides: number,
): boolean {
  if (totalSlides <= 3) return true;

  const directDistance = Math.abs(index - currentIndex);
  const wrappedDistance = totalSlides - directDistance;

  return Math.min(directDistance, wrappedDistance) <= 1;
}

function FeaturedCarouselSkeleton({ shorter }: { shorter?: boolean }) {
  return (
    <div
      className={classNames(
        "relative w-full transition-[height] duration-300 ease-in-out",
        shorter ? "h-[75vh]" : "h-[75vh] md:h-[100vh]",
      )}
    >
      <div className="relative w-full h-full overflow-hidden">
        <div
          className="absolute inset-0 bg-gray-900"
          style={{
            maskImage:
              "linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 1) 500px)",
            WebkitMaskImage:
              "linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 1) 500px)",
          }}
        />
      </div>

      {/* Navigation Buttons Skeleton */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/30">
        <div className="w-8 h-8 bg-gray-900 rounded-full animate-pulse" />
      </div>
      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/30">
        <div className="w-8 h-8 bg-gray-900 rounded-full animate-pulse" />
      </div>

      {/* Navigation Dots Skeleton */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[19] flex gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
          <div
            key={i}
            className="w-2.5 h-2.5 rounded-full bg-gray-900 animate-pulse"
          />
        ))}
      </div>

      {/* Content Overlay Skeleton */}
      <div className="absolute inset-0 flex items-end pb-20 z-10">
        <div className="container mx-auto px-8 md:px-4">
          <div className="max-w-3xl">
            <div className="h-12 w-48 bg-gray-900 rounded animate-pulse mb-6" />
            <div className="space-y-2 mb-6">
              <div className="h-4 bg-gray-900 rounded animate-pulse w-3/4" />
              <div className="h-4 bg-gray-900 rounded animate-pulse w-1/2" />
            </div>
            <div className="flex gap-4 justify-center items-center sm:justify-start">
              <div className="h-10 w-32 bg-gray-900 rounded animate-pulse" />
              <div className="h-10 w-32 bg-gray-900 rounded animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FeaturedCarousel({
  onShowDetails,
  onInitialContentReady,
  children,
  searching,
  shorter,
}: FeaturedCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [media, setMedia] = useState<FeaturedMedia[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [logoUrl, setLogoUrl] = useState<string | undefined>();
  const [imdbData, setImdbData] = useState<FeaturedIMDbData | null>(null);
  const [rtData, setRtData] = useState<FeaturedRTData | null>(null);
  const [isLoadingImdb, setIsLoadingImdb] = useState(false);
  const [isLoadingRt, setIsLoadingRt] = useState(false);
  const logoFetchController = useRef<AbortController | null>(null);
  const autoPlayInterval = useRef<NodeJS.Timeout | null>(null);
  const imdbCacheRef = useRef<Record<string, FeaturedIMDbData | null>>({});
  const rtCacheRef = useRef<Record<string, FeaturedRTData | null>>({});
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchEndXRef = useRef<number | null>(null);
  const touchEndYRef = useRef<number | null>(null);
  const navigate = useNavigate();

  const userLanguage = useLanguageStore((s) => s.language);
  const progressItems = useProgressStore((s) => s.items);
  const formattedLanguage = getTmdbLanguageCode(userLanguage);
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const [contentOpacity, setContentOpacity] = useState(1);
  const isRestoring = useIsRestoring();
  const hasReportedInitialContent = useRef(false);

  const [trailerReady, setTrailerReady] = useState(false);
  const trailerPlayerRef = useRef<TrailerPlayerHandle>(null);
  const isTrailerEnabled = usePreferencesStore((s) => s.enableTrailer);
  const setEnableTrailer = usePreferencesStore((s) => s.setEnableTrailer);
  const isTrailerMuted = !usePreferencesStore((s) => s.enableTrailerAudio);
  const setEnableTrailerAudio = usePreferencesStore(
    (s) => s.setEnableTrailerAudio,
  );
  const currentMedia = media[currentIndex];

  const SLIDE_QUANTITY = 15;
  const INITIAL_DETAIL_BATCH = 6;
  const INITIAL_SLIDE_QUANTITY = 4;
  const SLIDE_DURATION = 8000;
  const FEATURED_POOL_SIZE = 20;

  useEffect(() => {
    if (isRestoring) return;

    let isCancelled = false;

    const reportInitialContentReady = () => {
      if (hasReportedInitialContent.current) return;
      hasReportedInitialContent.current = true;
      onInitialContentReady?.();
    };

    const fetchFeaturedMedia = async () => {
      hasReportedInitialContent.current = false;
      setIsLoading(true);
      // Clear all previous data when transitioning
      setLogoUrl(undefined);
      setCurrentIndex(0);
      setContentOpacity(1);
      if (logoFetchController.current) {
        logoFetchController.current.abort();
      }

      try {
        const endpointList = async <T,>(path: string, page = 1) => {
          let data = await fetchCachedTmdb<{ results?: T[] }>(path, {
            language: formattedLanguage,
            page,
          });
          if (
            (!data.results || data.results.length === 0) &&
            formattedLanguage !== "en-US"
          ) {
            data = await fetchCachedTmdb<{ results?: T[] }>(path, {
              language: "en-US",
              page,
            });
          }
          return data.results ?? [];
        };

        type MediaPick = {
          id: number;
          type: "movie" | "show";
          source: "day" | "week";
          vote_average?: number;
          vote_count?: number;
          release_date?: string;
          first_air_date?: string;
        };
        type TrendingAllItem = {
          id: number;
          media_type?: string;
          vote_average?: number;
          vote_count?: number;
          release_date?: string;
          first_air_date?: string;
        };

        const fetchDetails = async (picks: MediaPick[]) =>
          Promise.all(
            picks.map((pick) =>
              pick.type === "movie"
                ? fetchCachedTmdb<any>(`/movie/${pick.id}`, {
                    language: formattedLanguage,
                    append_to_response: "external_ids,release_dates",
                  })
                : fetchCachedTmdb<any>(`/tv/${pick.id}`, {
                    language: formattedLanguage,
                    append_to_response: "external_ids",
                  }),
            ),
          );

        const uniqueByKey = (items: MediaPick[]) => {
          const seen = new Set<string>();
          return items.filter((item) => {
            const key = `${item.type}-${item.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        };
        const toMediaPick = (
          item: TrendingAllItem,
          source: "day" | "week",
        ): MediaPick | null => {
          if (item.media_type === "movie") {
            return {
              id: item.id,
              type: "movie",
              source,
              vote_average: item.vote_average,
              vote_count: item.vote_count,
              release_date: item.release_date,
            };
          }

          if (item.media_type === "tv") {
            return {
              id: item.id,
              type: "show",
              source,
              vote_average: item.vote_average,
              vote_count: item.vote_count,
              first_air_date: item.first_air_date,
            };
          }

          return null;
        };
        const selectFeaturedPool = (items: MediaPick[], limit: number) => {
          return uniqueByKey(items).slice(0, limit);
        };
        const mapTrendingItems = (
          items: TrendingAllItem[],
          source: "day" | "week",
        ) =>
          items
            .map((item) => toMediaPick(item, source))
            .filter((item): item is MediaPick => item !== null);
        const [trendingDay, trendingWeek] = await Promise.all([
          endpointList<TrendingAllItem>("/trending/all/day"),
          endpointList<TrendingAllItem>("/trending/all/week"),
        ]);

        const rankedSelection = selectFeaturedPool(
          [
            ...mapTrendingItems(trendingDay, "day"),
            ...mapTrendingItems(trendingWeek, "week"),
          ],
          FEATURED_POOL_SIZE,
        );
        const initialSelection = rankedSelection.slice(0, INITIAL_DETAIL_BATCH);
        const remainingSelection = rankedSelection.slice(INITIAL_DETAIL_BATCH);

        const initialDetails = await fetchDetails(initialSelection);
        const initialFeatured: FeaturedMedia[] = initialDetails.map(
          (item, index) => ({
            ...item,
            source: initialSelection[index].source,
            type: initialSelection[index].type,
          }),
        );
        const initialSlides = selectFeaturedSlides(
          initialFeatured,
          INITIAL_SLIDE_QUANTITY,
        );

        if (!isCancelled && initialSlides.length > 0) {
          setMedia(initialSlides);
          setIsLoading(false);
          reportInitialContentReady();
        }

        const remainingDetails =
          remainingSelection.length > 0
            ? await fetchDetails(remainingSelection)
            : [];

        if (isCancelled) return;

        const allDetails = [...initialDetails, ...remainingDetails];
        const allSelections = [...initialSelection, ...remainingSelection];
        const featured: FeaturedMedia[] = allDetails.map((item, index) => ({
          ...item,
          source: allSelections[index].source,
          type: allSelections[index].type,
        }));

        setMedia(selectFeaturedSlides(featured, SLIDE_QUANTITY));
        setIsLoading(false);
        reportInitialContentReady();
      } catch (error) {
        if (isCancelled) return;
        console.error("Error fetching featured media:", error);
        setMedia([]);
        setIsLoading(false);
        reportInitialContentReady();
      } finally {
        if (!isCancelled && !hasReportedInitialContent.current) {
          setIsLoading(false);
          reportInitialContentReady();
        }
      }
    };

    fetchFeaturedMedia();

    return () => {
      isCancelled = true;
    };
  }, [formattedLanguage, isRestoring, onInitialContentReady]);

  const handlePrevSlide = () => {
    setContentOpacity(0);

    // Wait for fade out, then change index and fade in
    setTimeout(() => {
      setCurrentIndex((prev) => (prev - 1 + media.length) % media.length);
      // Clear logo after index change so new logo can load
      setLogoUrl(undefined);
      setTimeout(() => setContentOpacity(1), 100);
    }, 150);

    // Reset autoplay timer
    if (autoPlayInterval.current) {
      clearInterval(autoPlayInterval.current);
    }
    if (isAutoPlaying) {
      autoPlayInterval.current = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % media.length);
      }, 5000);
    }
  };

  const handleNextSlide = () => {
    setContentOpacity(0);

    // Wait for fade out, then change index and fade in
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % media.length);
      // Clear logo after index change so new logo can load
      setLogoUrl(undefined);
      setTimeout(() => setContentOpacity(1), 100);
    }, 150);

    // Reset autoplay timer
    if (autoPlayInterval.current) {
      clearInterval(autoPlayInterval.current);
    }
    if (isAutoPlaying) {
      autoPlayInterval.current = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % media.length);
      }, 5000);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.targetTouches[0]?.clientX ?? null;
    touchStartYRef.current = e.targetTouches[0]?.clientY ?? null;
    touchEndXRef.current = null;
    touchEndYRef.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndXRef.current = e.targetTouches[0]?.clientX ?? null;
    touchEndYRef.current = e.targetTouches[0]?.clientY ?? null;
  };

  const handleTouchEnd = () => {
    if (
      touchStartXRef.current === null ||
      touchStartYRef.current === null ||
      touchEndXRef.current === null ||
      touchEndYRef.current === null
    ) {
      return;
    }

    const distanceX = touchStartXRef.current - touchEndXRef.current;
    const distanceY = touchStartYRef.current - touchEndYRef.current;
    const minSwipeDistance = 50;

    if (
      Math.abs(distanceX) > minSwipeDistance &&
      Math.abs(distanceX) > Math.abs(distanceY)
    ) {
      if (distanceX > 0) {
        handleNextSlide();
      } else {
        handlePrevSlide();
      }
    }

    touchStartXRef.current = null;
    touchStartYRef.current = null;
    touchEndXRef.current = null;
    touchEndYRef.current = null;
  };

  const handleTouchCancel = () => {
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    touchEndXRef.current = null;
    touchEndYRef.current = null;
  };

  useEffect(() => {
    setTrailerReady(false);
  }, [currentIndex]);

  const toggleTrailer = () => {
    setEnableTrailer(!isTrailerEnabled);
    setTrailerReady(false);
  };

  // Fetch clear logo when current media changes
  useEffect(() => {
    const fetchLogo = async () => {
      // Cancel any in-progress logo fetch
      if (logoFetchController.current) {
        logoFetchController.current.abort();
      }

      // Create new abort controller for this fetch
      logoFetchController.current = new AbortController();

      const currentMediaId = media[currentIndex]?.id;
      if (!currentMediaId) {
        setLogoUrl(undefined);
        return;
      }

      try {
        const logo = await getMediaLogo(
          currentMediaId.toString(),
          media[currentIndex].type === "movie"
            ? TMDBContentTypes.MOVIE
            : TMDBContentTypes.TV,
        );
        // Only update if this is still the current media
        if (media[currentIndex]?.id === currentMediaId) {
          setLogoUrl(logo);
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
          // Ignore abort errors
          return;
        }
        console.error("Error fetching logo:", error);
        setLogoUrl(undefined);
      }
    };

    fetchLogo();

    return () => {
      if (logoFetchController.current) {
        logoFetchController.current.abort();
      }
    };
  }, [currentIndex, media]);

  useEffect(() => {
    let isCancelled = false;
    const mediaId = currentMedia?.id;
    const mediaType = currentMedia?.type;
    const mediaTitle = currentMedia?.title || currentMedia?.name;
    const mediaImdbId = currentMedia?.external_ids?.imdb_id;
    const mediaReleaseDate =
      currentMedia?.release_date || currentMedia?.first_air_date;

    if (!mediaId || !mediaType) {
      setImdbData(null);
      setRtData(null);
      setIsLoadingImdb(false);
      setIsLoadingRt(false);
      return () => {
        isCancelled = true;
      };
    }

    const cacheKey = `${mediaType}-${mediaId}`;

    const fetchImdbData = async () => {
      if (!mediaImdbId) {
        setImdbData(null);
        setIsLoadingImdb(false);
        return;
      }

      if (
        Object.prototype.hasOwnProperty.call(imdbCacheRef.current, cacheKey)
      ) {
        setImdbData(imdbCacheRef.current[cacheKey]);
        setIsLoadingImdb(false);
        return;
      }

      setImdbData(null);
      setIsLoadingImdb(true);

      try {
        const imdbMetadata = await getIMDbMetadata(
          mediaImdbId,
          undefined,
          undefined,
          formattedLanguage,
        );

        if (isCancelled) return;

        const normalizedImdbData =
          imdbMetadata &&
          typeof imdbMetadata.imdb_rating === "number" &&
          typeof imdbMetadata.votes === "number"
            ? {
                rating: imdbMetadata.imdb_rating,
                votes: imdbMetadata.votes,
              }
            : null;

        imdbCacheRef.current[cacheKey] = normalizedImdbData;
        setImdbData(normalizedImdbData);
      } catch (error) {
        if (!isCancelled) {
          imdbCacheRef.current[cacheKey] = null;
          setImdbData(null);
        }
        console.error("Failed to fetch featured IMDb data:", error);
      } finally {
        if (!isCancelled) {
          setIsLoadingImdb(false);
        }
      }
    };

    const fetchRtData = async () => {
      if (!mediaTitle) {
        setRtData(null);
        setIsLoadingRt(false);
        return;
      }

      if (Object.prototype.hasOwnProperty.call(rtCacheRef.current, cacheKey)) {
        setRtData(rtCacheRef.current[cacheKey]);
        setIsLoadingRt(false);
        return;
      }

      setRtData(null);
      setIsLoadingRt(true);

      try {
        const rtMetadata = await getRottenTomatoesMetadata(
          mediaTitle,
          mediaReleaseDate
            ? new Date(mediaReleaseDate).getFullYear()
            : undefined,
        );

        if (isCancelled) return;

        rtCacheRef.current[cacheKey] = rtMetadata;
        setRtData(rtMetadata);
      } catch (error) {
        if (!isCancelled) {
          rtCacheRef.current[cacheKey] = null;
          setRtData(null);
        }
        console.error("Failed to fetch featured Rotten Tomatoes data:", error);
      } finally {
        if (!isCancelled) {
          setIsLoadingRt(false);
        }
      }
    };

    void fetchImdbData();
    void fetchRtData();

    return () => {
      isCancelled = true;
    };
  }, [
    currentMedia?.id,
    currentMedia?.type,
    currentMedia?.title,
    currentMedia?.name,
    currentMedia?.external_ids?.imdb_id,
    currentMedia?.release_date,
    currentMedia?.first_air_date,
    formattedLanguage,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (logoFetchController.current) {
        logoFetchController.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (isAutoPlaying && media.length > 0) {
      autoPlayInterval.current = setInterval(() => {
        setContentOpacity(0);

        // Wait for fade out, then change index and fade in
        setTimeout(() => {
          setCurrentIndex((prev) => (prev + 1) % media.length);
          // Clear logo after index change so new logo can load
          setLogoUrl(undefined);
          setTimeout(() => setContentOpacity(1), 100);
        }, 150);
      }, SLIDE_DURATION);
    }

    return () => {
      if (autoPlayInterval.current) {
        clearInterval(autoPlayInterval.current);
      }
    };
  }, [isAutoPlaying, media.length]);

  if (isLoading) {
    return <FeaturedCarouselSkeleton shorter={shorter} />;
  }

  if (media.length === 0) {
    return <FeaturedCarouselSkeleton shorter={shorter} />;
  }

  const mediaTitle = currentMedia.title || currentMedia.name;
  const mediaYear = currentMedia.release_date || currentMedia.first_air_date;
  const tmdbVoteAverage = currentMedia.vote_average;
  const inlineLoadingClass =
    "h-4 w-14 rounded bg-white/10 animate-pulse inline-block";
  const hasTmdbRating = typeof tmdbVoteAverage === "number";
  const hasImdbRating = isLoadingImdb || Boolean(imdbData);
  const hasRtRating = isLoadingRt || Boolean(rtData);
  const hasAudienceRating =
    isLoadingRt || typeof rtData?.popcornScore === "number";
  const hasMediaYear = typeof mediaYear === "string";
  const hasSeasonCount =
    currentMedia?.type === "show" && Boolean(currentMedia?.number_of_seasons);
  const progressItem = currentMedia?.id
    ? progressItems[currentMedia.id.toString()]
    : undefined;
  const showProgress = progressItem ? shouldShowProgress(progressItem) : null;
  const progressPercentage = showProgress?.show
    ? getProgressPercentage(
        showProgress.progress.watched,
        showProgress.progress.duration,
      )
    : undefined;
  const playButtonLabel =
    showProgress &&
    currentMedia.type === "show" &&
    showProgress.season &&
    showProgress.episode
      ? `${t("details.resume")} S${showProgress.season.number}:E${showProgress.episode.number}`
      : currentMedia.type === "movie"
        ? !currentMedia.release_date ||
          new Date(currentMedia.release_date) > new Date()
          ? t("media.unreleased")
          : showProgress
            ? t("details.resume")
            : t("details.play")
        : showProgress
          ? t("details.resume")
          : t("details.play");
  const playUrlId =
    currentMedia.id && mediaTitle
      ? TMDBIdToUrlId(
          currentMedia.type === "movie"
            ? MWMediaType.MOVIE
            : MWMediaType.SERIES,
          currentMedia.id.toString(),
          mediaTitle,
        )
      : null;
  const releaseQuality: ReleaseQualityVariant | null =
    currentMedia?.type === "movie"
      ? getReleaseQualityVariantFromTmdbReleaseDates(currentMedia.release_dates)
      : null;
  const hasMetadataAfterQualityBadge =
    hasTmdbRating ||
    hasImdbRating ||
    hasRtRating ||
    hasAudienceRating ||
    hasMediaYear ||
    hasSeasonCount;

  let searchClasses = "";
  if (searching) searchClasses = "opacity-0 transition-opacity duration-300";
  else searchClasses = "opacity-100 transition-opacity duration-300";

  return (
    <div
      className={classNames(
        "relative w-full transition-[height] duration-300 ease-in-out",
        searching
          ? "h-24"
          : shorter
            ? windowHeight > 600
              ? "h-[40rem] md:h-[85vh]"
              : "h-[100vh]"
            : "h-[40rem] md:h-[100vh]",
      )}
      style={{ touchAction: "pan-y" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      <div
        className={classNames(
          "relative w-full h-full overflow-hidden",
          searchClasses,
        )}
      >
        {media.map((item, index) => {
          const imagePath = getSlideImagePath(item);

          return (
            <div
              key={`${item.type}-${item.id}`}
              className={`absolute inset-0 transition-opacity duration-1000 ${
                index === currentIndex ? "opacity-100" : "opacity-0"
              }`}
            >
              <LazyImage
                src={
                  shouldLoadSlideImage(index, currentIndex, media.length) &&
                  imagePath
                    ? `https://image.tmdb.org/t/p/original${imagePath}`
                    : undefined
                }
                alt={item.title || item.name || ""}
                className="absolute inset-0 w-full h-full object-cover object-top"
                loading={index === currentIndex ? "eager" : "lazy"}
                style={{
                  maskImage:
                    "linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 1) 700px)",
                  WebkitMaskImage:
                    "linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 1) 700px)",
                  opacity:
                    isTrailerEnabled && index === currentIndex && trailerReady
                      ? 0
                      : 1,
                  transition: "opacity 0.8s ease",
                }}
              />
              <TrailerPlayer
                tmdbId={item.id!.toString()}
                tmdbType={item.type === "movie" ? "movie" : "show"}
                initialImdbId={item.external_ids?.imdb_id}
                isActive={isTrailerEnabled && index === currentIndex}
                isMuted={isTrailerMuted}
                ref={index === currentIndex ? trailerPlayerRef : undefined}
                onPlay={() => {
                  if (isTrailerEnabled && index === currentIndex) {
                    setTrailerReady(true);
                  }
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Navigation Buttons */}
      <button
        type="button"
        onClick={handlePrevSlide}
        className={classNames(
          "absolute left-4 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/30 hover:bg-black/50 transition-colors",
          searchClasses,
        )}
        aria-label="Previous slide"
      >
        <Icon icon={Icons.CHEVRON_LEFT} className="text-white w-8 h-8" />
      </button>
      <button
        type="button"
        onClick={handleNextSlide}
        className={classNames(
          "absolute right-4 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/30 hover:bg-black/50 transition-colors",
          searchClasses,
        )}
        aria-label="Next slide"
      >
        <Icon icon={Icons.CHEVRON_RIGHT} className="text-white w-8 h-8" />
      </button>
      {/* Navigation Dots */}
      <div
        className={classNames(
          "absolute bottom-8 left-1/2 -translate-x-1/2 z-[19] flex gap-2",
          searchClasses,
        )}
      >
        {media.map((item, index) => (
          <button
            key={`dot-${item.type}-${item.id}`}
            type="button"
            onClick={() => {
              setContentOpacity(0);

              // Wait for fade out, then change index and fade in
              setTimeout(() => {
                setCurrentIndex(index);
                // Clear logo after index change so new logo can load
                setLogoUrl(undefined);
                setTimeout(() => setContentOpacity(1), 100);
              }, 150);

              // Reset autoplay timer when clicking dots
              if (autoPlayInterval.current) {
                clearInterval(autoPlayInterval.current);
              }
              if (isAutoPlaying) {
                autoPlayInterval.current = setInterval(() => {
                  setCurrentIndex((prev) => (prev + 1) % media.length);
                }, SLIDE_DURATION);
              }
            }}
            className={`w-2.5 h-2.5 rounded-full transition-all ${
              index === currentIndex
                ? "bg-white scale-125"
                : "bg-white/50 hover:bg-white/75"
            }`}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>

      {/* Content Overlay */}
      <div
        className={classNames(
          "absolute inset-0 flex items-end pb-20 z-10 transition-opacity duration-150",
          searchClasses,
        )}
        style={{ opacity: contentOpacity }}
      >
        <div className="container mx-auto px-8 lg:px-4 flex justify-between items-end w-full">
          <div className="max-w-3xl">
            {logoUrl ? (
              <LazyImage
                src={logoUrl}
                alt={mediaTitle}
                className="max-w-[14rem] md:max-w-[22rem] max-h-[20vh] object-contain drop-shadow-lg bg-transparent mb-6"
                style={{ background: "none" }}
              />
            ) : (
              <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">
                {mediaTitle}
              </h1>
            )}
            {/* TMDB Rating and Year/Seasons */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80 mb-4">
              {releaseQuality && (
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <ReleaseQualityBadge
                    variant={releaseQuality}
                    className="bg-black/30"
                  />
                  {hasMetadataAfterQualityBadge && (
                    <span className="text-white/60">•</span>
                  )}
                </div>
              )}

              {hasTmdbRating && (
                <div className="flex items-center gap-1 whitespace-nowrap">
                  <Icon icon={Icons.TMDB} />
                  <span>{tmdbVoteAverage.toFixed(1)}</span>
                  {typeof currentMedia.vote_count === "number" && (
                    <span className="text-white/60">
                      ({currentMedia.vote_count.toLocaleString()})
                    </span>
                  )}
                </div>
              )}

              {hasImdbRating && (
                <div className="flex items-center gap-2 whitespace-nowrap">
                  {hasTmdbRating && <span className="text-white/60">•</span>}
                  <div className="flex items-center gap-1">
                    <Icon icon={Icons.IMDB} className="text-yellow-400" />
                    {isLoadingImdb ? (
                      <span className={inlineLoadingClass} />
                    ) : (
                      <span>{imdbData?.rating.toFixed(1)}</span>
                    )}
                    {!isLoadingImdb && typeof imdbData?.votes === "number" && (
                      <span className="text-white/60">
                        ({imdbData.votes.toLocaleString()})
                      </span>
                    )}
                  </div>
                </div>
              )}

              {hasRtRating && (
                <div className="flex items-center gap-2 whitespace-nowrap">
                  {(hasTmdbRating || hasImdbRating) && (
                    <span className="text-white/60">•</span>
                  )}
                  <div className="flex items-center gap-1">
                    {rtData ? (
                      <img
                        src={getRTIcon(rtData.tomatoIcon)}
                        alt="Tomatometer"
                        className="h-4 w-4"
                      />
                    ) : (
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#fa320a]">
                        RT
                      </span>
                    )}
                    {isLoadingRt ? (
                      <span className={inlineLoadingClass} />
                    ) : (
                      <span>{rtData?.tomatoScore}%</span>
                    )}
                  </div>
                </div>
              )}

              {hasAudienceRating && (
                <div className="flex items-center gap-2 whitespace-nowrap">
                  {(hasTmdbRating || hasImdbRating || hasRtRating) && (
                    <span className="text-white/60">•</span>
                  )}
                  <div className="flex items-center gap-1">
                    <img
                      src={getRTAudienceIcon(rtData?.popcornIcon ?? "empty")}
                      alt="Popcornmeter"
                      className="h-4 w-4"
                    />
                    {isLoadingRt ? (
                      <span className={inlineLoadingClass} />
                    ) : (
                      <span>{rtData?.popcornScore}%</span>
                    )}
                  </div>
                </div>
              )}

              {hasMediaYear && (
                <div className="flex items-center gap-2 whitespace-nowrap">
                  {(hasTmdbRating ||
                    hasImdbRating ||
                    hasRtRating ||
                    hasAudienceRating) && (
                    <span className="text-white/60">•</span>
                  )}
                  <span>{new Date(mediaYear).getFullYear()}</span>
                </div>
              )}
              {hasSeasonCount && (
                <div className="flex items-center gap-2 whitespace-nowrap">
                  {(hasTmdbRating ||
                    hasImdbRating ||
                    hasRtRating ||
                    hasAudienceRating ||
                    hasMediaYear) && <span className="text-white/60">•</span>}
                  <span>
                    {currentMedia.number_of_seasons} {t("details.seasons")}
                  </span>
                </div>
              )}
            </div>
            <p className="text-lg text-white mb-6 line-clamp-3 md:line-clamp-4">
              {currentMedia.overview}
            </p>
            <div
              className="w-full max-w-md"
              onMouseEnter={() => setIsAutoPlaying(false)}
              onMouseLeave={() => setIsAutoPlaying(true)}
            >
              <div className="flex gap-4 justify-center items-center sm:justify-start">
                <Button
                  onClick={() => {
                    if (!playUrlId) return;

                    if (
                      currentMedia.type === "show" &&
                      showProgress?.season?.id &&
                      showProgress?.episode?.id
                    ) {
                      navigate(
                        `/media/${playUrlId}/${showProgress.season.id}/${showProgress.episode.id}`,
                      );
                      return;
                    }

                    navigate(`/media/${playUrlId}`);
                  }}
                  theme="purple"
                  className="w-full sm:w-auto text-base"
                  disabled={!playUrlId}
                >
                  <Icon icon={Icons.PLAY} className="text-white" />
                  <span className="text-white whitespace-nowrap">
                    {playButtonLabel}
                  </span>
                </Button>
                <Button
                  onClick={() => onShowDetails(currentMedia)}
                  theme="secondary"
                  className="w-full sm:w-auto text-base"
                >
                  <Icon
                    icon={Icons.CIRCLE_QUESTION}
                    className="text-white scale-100"
                  />
                  <span className="text-white whitespace-nowrap">
                    {t("discover.featured.moreInfo")}
                  </span>
                </Button>
              </div>

              {progressPercentage !== undefined ? (
                <div className="mt-3 w-full">
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-white/80">
                    <span className="truncate">
                      {currentMedia.type === "show" &&
                      showProgress?.season &&
                      showProgress.episode
                        ? t("media.episodeDisplay", {
                            season: showProgress.season.number,
                            episode: showProgress.episode.number,
                          })
                        : t("details.resume")}
                    </span>
                    <span>{Math.round(progressPercentage)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-progress-background/25">
                    <div
                      className="h-full rounded-full bg-progress-filled transition-[width] duration-300"
                      style={{ width: `${progressPercentage}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="hidden items-center gap-2 lg:flex">
            <button
              type="button"
              onClick={toggleTrailer}
              className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-pill-background bg-opacity-50 text-white transition-all duration-300 ease-in-out hover:bg-pill-backgroundHover"
              aria-label={isTrailerEnabled ? "Show image" : "Show trailer"}
              aria-pressed={!isTrailerEnabled}
              title={isTrailerEnabled ? "Show image" : "Show trailer"}
            >
              <Icon
                icon={isTrailerEnabled ? Icons.IMG_X : Icons.IMG}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-2xl text-white"
              />
            </button>
            <button
              type="button"
              onClick={() => {
                const nextMuted = !isTrailerMuted;
                trailerPlayerRef.current?.setMuted(nextMuted);
                setEnableTrailerAudio(!nextMuted);
              }}
              className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-pill-background bg-opacity-50 text-white transition-all duration-300 ease-in-out hover:bg-pill-backgroundHover"
              aria-label={isTrailerMuted ? "Unmute trailer" : "Mute trailer"}
              aria-pressed={!isTrailerMuted}
              title={isTrailerMuted ? "Unmute trailer" : "Mute trailer"}
            >
              <Icon
                icon={isTrailerMuted ? Icons.VOLUME_X : Icons.VOLUME}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-2xl text-white"
              />
            </button>
            <RandomMovieButton />
          </div>
        </div>
      </div>
      {children && (
        <div
          className={classNames(
            "absolute inset-0 pointer-events-none",
            windowWidth > 1280 ? "pt-0" : "pt-14",
          )}
        >
          <div className="pointer-events-auto z-50">{children}</div>
        </div>
      )}
    </div>
  );
}
