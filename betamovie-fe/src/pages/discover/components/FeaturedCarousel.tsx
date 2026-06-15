import { useIsRestoring } from "@tanstack/react-query";
import classNames from "classnames";
import { t } from "i18next";
import { ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWindowSize } from "react-use";

import { isExtensionActive } from "@/backend/extension/messaging";
import { getMediaLogo } from "@/backend/metadata/tmdb";
import { TMDBContentTypes } from "@/backend/metadata/types/tmdb";
import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import { LazyImage } from "@/components/utils/Image";
import { Movie, TVShow } from "@/pages/discover/common";
import { useLanguageStore } from "@/stores/language";
import { usePreferencesStore } from "@/stores/preferences";
import { filterAndSortByQualityDesc } from "@/utils/compareByRatingDesc";
import { scrapeIMDb } from "@/utils/imdbScraper";
import { getTmdbLanguageCode } from "@/utils/language";
import { fetchCachedTmdb } from "@/utils/tmdbQuery";

import { RandomMovieButton } from "./RandomMovieButton";

export interface FeaturedMedia extends Partial<Movie & TVShow> {
  children?: ReactNode;
  backdrop_path?: string;
  overview: string;
  title?: string;
  name?: string;
  type: "movie" | "show";
  source?: "latest" | "popular";
  vote_average?: number;
  vote_count?: number;
  number_of_seasons?: number;
  imdb_rating?: number;
  imdb_votes?: number;
  external_ids?: {
    imdb_id?: string;
  };
}

interface FeaturedCarouselProps {
  onShowDetails: (media: FeaturedMedia) => void;
  onInitialContentReady?: () => void;
  children?: ReactNode;
  searching?: boolean;
  shorter?: boolean;
  forcedCategory?: "movies" | "tvshows";
}

interface IMDbRatingData {
  rating: number;
  votes: number;
}

function shuffleArray<T>(items: T[]): T[] {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [
      shuffled[randomIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

function mixBalancedRandom<T extends { type: "movie" | "show" }>(
  shows: T[],
  movies: T[],
): T[] {
  const showQueue = shuffleArray(shows);
  const movieQueue = shuffleArray(movies);
  const mixed: T[] = [];

  while (showQueue.length > 0 || movieQueue.length > 0) {
    const lastTwoTypes = mixed.slice(-2).map((item) => item.type);
    const shouldForceMovie =
      lastTwoTypes.length === 2 &&
      lastTwoTypes.every((type) => type === "show") &&
      movieQueue.length > 0;
    const shouldForceShow =
      lastTwoTypes.length === 2 &&
      lastTwoTypes.every((type) => type === "movie") &&
      showQueue.length > 0;

    if (shouldForceMovie) {
      mixed.push(movieQueue.shift()!);
      continue;
    }

    if (shouldForceShow) {
      mixed.push(showQueue.shift()!);
      continue;
    }

    if (showQueue.length === 0) {
      mixed.push(movieQueue.shift()!);
      continue;
    }

    if (movieQueue.length === 0) {
      mixed.push(showQueue.shift()!);
      continue;
    }

    if (Math.random() < 0.5) {
      mixed.push(showQueue.shift()!);
    } else {
      mixed.push(movieQueue.shift()!);
    }
  }

  return mixed;
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
  forcedCategory,
}: FeaturedCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [media, setMedia] = useState<FeaturedMedia[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [logoUrl, setLogoUrl] = useState<string | undefined>();
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [imdbRatings, setImdbRatings] = useState<
    Record<string, IMDbRatingData>
  >({});
  const hasExtension = useRef<boolean>(false);
  const logoFetchController = useRef<AbortController | null>(null);
  const autoPlayInterval = useRef<NodeJS.Timeout | null>(null);
  const navigate = useNavigate();

  const enableImageLogos = usePreferencesStore(
    (state) => state.enableImageLogos,
  );
  const userLanguage = useLanguageStore((s) => s.language);
  const formattedLanguage = getTmdbLanguageCode(userLanguage);
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const [contentOpacity, setContentOpacity] = useState(1);
  const isRestoring = useIsRestoring();
  const hasReportedInitialContent = useRef(false);

  const currentMedia = media[currentIndex];

  const SLIDE_QUANTITY = 15;
  const INITIAL_DETAIL_BATCH = 6;
  const INITIAL_SLIDE_QUANTITY = 4;
  const SLIDE_DURATION = 8000;
  const BASE_POOL_SIZE_PER_TYPE = 6;
  const EXTRA_POOL_SIZE_PER_TYPE = 4;
  const FEATURED_CANDIDATE_PAGES = 2;

  // Check for extension on mount
  useEffect(() => {
    isExtensionActive().then((active) => {
      hasExtension.current = active;
    });
  }, []);

  // Fetch IMDb ratings when media changes
  useEffect(() => {
    const fetchImdbRatings = async () => {
      if (!hasExtension.current || !currentMedia?.external_ids?.imdb_id) return;

      try {
        const imdbData = await scrapeIMDb(
          currentMedia.external_ids.imdb_id,
          undefined,
          undefined,
          undefined,
          currentMedia.type,
        );
        // Only update if we have both rating and votes as non-null numbers
        if (
          typeof imdbData.imdb_rating === "number" &&
          typeof imdbData.votes === "number"
        ) {
          const ratingData: IMDbRatingData = {
            rating: imdbData.imdb_rating,
            votes: imdbData.votes,
          };
          setImdbRatings((prev) => ({
            ...prev,
            [currentMedia.external_ids!.imdb_id!]: ratingData,
          }));
        }
      } catch (error) {
        console.error("Error fetching IMDb ratings:", error);
      }
    };

    if (currentMedia) {
      fetchImdbRatings();
    }
  }, [currentMedia]);

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
      setImdbRatings({});
      setCurrentIndex(0);
      setContentOpacity(1);
      if (logoFetchController.current) {
        logoFetchController.current.abort();
      }

      try {
        const endpointList = async (path: string, page = 1) => {
          let data = await fetchCachedTmdb<any>(path, {
            language: formattedLanguage,
            page,
          });
          if (
            (!data.results || data.results.length === 0) &&
            formattedLanguage !== "en-US"
          ) {
            data = await fetchCachedTmdb<any>(path, {
              language: "en-US",
              page,
            });
          }
          return data.results ?? [];
        };

        type MediaPick = {
          id: number;
          type: "movie" | "show";
          source: "latest" | "popular";
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
                    append_to_response: "external_ids",
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
        const endpointPages = async (path: string) => {
          const pageResults = await Promise.all(
            Array.from({ length: FEATURED_CANDIDATE_PAGES }, (_, index) =>
              endpointList(path, index + 1),
            ),
          );

          return pageResults.flat();
        };
        const toMoviePick = (
          movie: {
            id: number;
            vote_average?: number;
            vote_count?: number;
            release_date?: string;
          },
          source: "latest" | "popular",
        ): MediaPick => ({
          id: movie.id,
          type: "movie",
          source,
          vote_average: movie.vote_average,
          vote_count: movie.vote_count,
          release_date: movie.release_date,
        });
        const toShowPick = (
          show: {
            id: number;
            vote_average?: number;
            vote_count?: number;
            first_air_date?: string;
          },
          source: "latest" | "popular",
        ): MediaPick => ({
          id: show.id,
          type: "show",
          source,
          vote_average: show.vote_average,
          vote_count: show.vote_count,
          first_air_date: show.first_air_date,
        });
        const selectFeaturedPool = (items: MediaPick[], limit: number) => {
          const filteredItems = filterAndSortByQualityDesc(uniqueByKey(items));
          return filteredItems.slice(0, limit);
        };
        const [nowPlaying, popularTv] = await Promise.all([
          endpointPages("/movie/now_playing"),
          endpointPages("/tv/popular"),
        ]);
        const movieFeaturedPool = selectFeaturedPool(
          nowPlaying.map(
            (show: {
              id: number;
              vote_average?: number;
              vote_count?: number;
              release_date?: string;
            }) => toMoviePick(show, "latest"),
          ),
          BASE_POOL_SIZE_PER_TYPE + EXTRA_POOL_SIZE_PER_TYPE,
        );
        const tvFeaturedPool = selectFeaturedPool(
          popularTv.map(
            (show: {
              id: number;
              vote_average?: number;
              vote_count?: number;
              first_air_date?: string;
            }) => toShowPick(show, "popular"),
          ),
          BASE_POOL_SIZE_PER_TYPE + EXTRA_POOL_SIZE_PER_TYPE,
        );
        const topTvPopular = tvFeaturedPool.slice(0, BASE_POOL_SIZE_PER_TYPE);
        const extraTvPopular = tvFeaturedPool.slice(BASE_POOL_SIZE_PER_TYPE);
        const topLatestMovies = movieFeaturedPool.slice(
          0,
          BASE_POOL_SIZE_PER_TYPE,
        );
        const extraLatestMovies = movieFeaturedPool.slice(
          BASE_POOL_SIZE_PER_TYPE,
        );
        const rankedSelection =
          forcedCategory === "movies"
            ? shuffleArray(movieFeaturedPool)
            : forcedCategory === "tvshows"
              ? shuffleArray(tvFeaturedPool)
              : uniqueByKey([
                  ...mixBalancedRandom(topTvPopular, topLatestMovies),
                  ...mixBalancedRandom(extraTvPopular, extraLatestMovies),
                ]);
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
  }, [forcedCategory, formattedLanguage, isRestoring, onInitialContentReady]);

  const handlePrevSlide = () => {
    setContentOpacity(0);
    setImdbRatings({});

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
    setImdbRatings({});

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
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;

    const distance = touchStart - touchEnd;
    const minSwipeDistance = 50;

    if (Math.abs(distance) > minSwipeDistance) {
      if (distance > 0) {
        handleNextSlide();
      } else {
        handlePrevSlide();
      }
    }

    setTouchStart(null);
    setTouchEnd(null);
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
        setImdbRatings({});

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
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
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
            {logoUrl && enableImageLogos ? (
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
            <div className="flex items-center gap-2 text-sm text-white/80 mb-4">
              {currentMedia?.vote_average && (
                <div className="flex items-center gap-1">
                  <Icon icon={Icons.TMDB} />
                  <span>{currentMedia.vote_average.toFixed(1)}</span>
                  {currentMedia.vote_count && (
                    <span className="text-white/60">
                      ({currentMedia.vote_count.toLocaleString()})
                    </span>
                  )}
                </div>
              )}
              {currentMedia?.external_ids?.imdb_id &&
                imdbRatings[currentMedia.external_ids.imdb_id] && (
                  <>
                    <span className="text-white/60">•</span>
                    <div className="flex items-center gap-1">
                      <Icon icon={Icons.IMDB} className="text-yellow-400" />
                      <span>
                        {imdbRatings[
                          currentMedia.external_ids.imdb_id
                        ].rating.toFixed(1)}
                      </span>
                      <span className="text-white/60">
                        (
                        {imdbRatings[
                          currentMedia.external_ids.imdb_id
                        ].votes.toLocaleString()}
                        )
                      </span>
                    </div>
                  </>
                )}
              {currentMedia?.release_date && (
                <>
                  <span className="text-white/60">•</span>
                  <span>
                    {new Date(currentMedia.release_date).getFullYear()}
                  </span>
                </>
              )}
              {currentMedia?.type === "show" &&
                currentMedia?.number_of_seasons && (
                  <>
                    <span className="text-white/60">•</span>
                    <span>
                      {currentMedia.number_of_seasons} {t("details.seasons")}
                    </span>
                  </>
                )}
            </div>
            <p className="text-lg text-white mb-6 line-clamp-3 md:line-clamp-4">
              {currentMedia.overview}
            </p>
            <div
              className="flex gap-4 justify-center items-center sm:justify-start"
              onMouseEnter={() => setIsAutoPlaying(false)}
              onMouseLeave={() => setIsAutoPlaying(true)}
            >
              <Button
                onClick={() =>
                  navigate(
                    `/media/tmdb-${currentMedia.type}-${currentMedia.id}-${mediaTitle?.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
                  )
                }
                theme="secondary"
                className="w-full sm:w-auto text-base"
              >
                <Icon icon={Icons.PLAY} className="text-white" />
                <span className="text-white whitespace-nowrap">
                  {t("discover.featured.playNow")}
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
          </div>
          <div className="hidden lg:block">
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
