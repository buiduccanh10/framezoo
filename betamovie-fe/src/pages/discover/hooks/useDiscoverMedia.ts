import { useIsRestoring } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  EDITOR_PICKS_MOVIES,
  EDITOR_PICKS_TV_SHOWS,
  MOVIE_PROVIDERS,
  TV_PROVIDERS,
} from "@/pages/discover/types/discover";
import type {
  Country,
  DiscoverContentType,
  DiscoverMedia,
  Genre,
  MediaType,
  Provider,
  UseDiscoverMediaProps,
  UseDiscoverMediaReturn,
} from "@/pages/discover/types/discover";
import { useLanguageStore } from "@/stores/language";
import {
  DEFAULT_MEDIA_QUALITY_THRESHOLD,
  filterAndSortByQualityDesc,
} from "@/utils/compareByRatingDesc";
import { getTmdbLanguageCode } from "@/utils/language";
import { fetchCachedTmdb } from "@/utils/tmdbQuery";

// Re-export types for backward compatibility
export type {
  Country,
  DiscoverContentType,
  DiscoverMedia,
  Genre,
  MediaType,
  Provider,
  UseDiscoverMediaProps,
  UseDiscoverMediaReturn,
};

// Re-export constants for backward compatibility
export {
  EDITOR_PICKS_MOVIES,
  EDITOR_PICKS_TV_SHOWS,
  MOVIE_PROVIDERS,
  TV_PROVIDERS,
};

export function useDiscoverOptions(
  mediaType: MediaType,
  options?: { includeCountries?: boolean },
) {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const includeCountries = options?.includeCountries ?? false;
  const isRestoring = useIsRestoring();

  const { t } = useTranslation();
  const userLanguage = useLanguageStore((s) => s.language);
  const formattedLanguage = getTmdbLanguageCode(userLanguage);

  const providers = mediaType === "movie" ? MOVIE_PROVIDERS : TV_PROVIDERS;

  useEffect(() => {
    const fetchOptions = async () => {
      if (isRestoring) return;

      setIsLoading(true);
      setError(null);

      try {
        const [genresData, countriesData] = await Promise.all([
          fetchCachedTmdb<any>(`/genre/${mediaType}/list`, {
            language: formattedLanguage,
          }),
          includeCountries
            ? fetchCachedTmdb<any[]>("/configuration/countries")
            : [],
        ]);

        setGenres(
          (genresData.genres || []).slice(0, 50).map((genre: Genre) => ({
            ...genre,
            name: t(`tmdb.genres.${genre.id}`, { defaultValue: genre.name }),
          })),
        );

        if (includeCountries) {
          const localizedCountryNames = new Intl.DisplayNames(
            [formattedLanguage, userLanguage, "en-US", "en"],
            { type: "region" },
          );
          const seen = new Set<string>();
          const mappedCountries: Country[] = (countriesData || [])
            .map((country) => {
              const countryId = country.iso_3166_1?.toUpperCase();
              if (!countryId) return null;
              if (seen.has(countryId)) return null;
              seen.add(countryId);

              const localizedName = localizedCountryNames.of(countryId);
              return {
                id: countryId,
                name:
                  localizedName && localizedName !== countryId
                    ? localizedName
                    : country.native_name || country.english_name || countryId,
              };
            })
            .filter((country): country is Country => Boolean(country))
            .sort((a, b) =>
              a.name.localeCompare(b.name, formattedLanguage, {
                sensitivity: "base",
              }),
            );

          setCountries(mappedCountries);
        } else {
          setCountries([]);
        }
      } catch (err) {
        console.error(`Error fetching ${mediaType} discover options:`, err);
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchOptions();
  }, [
    mediaType,
    formattedLanguage,
    userLanguage,
    includeCountries,
    isRestoring,
    t,
  ]);

  return {
    genres,
    countries,
    providers,
    isLoading,
    error,
  };
}

export function useDiscoverMedia({
  contentType,
  mediaType,
  id,
  fallbackType,
  page = 1,
  releaseYear,
  originCountry,
  genreName,
  providerName,
  mediaTitle,
  isCarouselView = false,
  enabled = true,
}: UseDiscoverMediaProps): UseDiscoverMediaReturn {
  const [media, setMedia] = useState<DiscoverMedia[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [sectionTitle, setSectionTitle] = useState<string>("");
  const [currentContentType, setCurrentContentType] =
    useState<string>(contentType);
  const [actualContentType, setActualContentType] =
    useState<DiscoverContentType>(contentType);
  const isRestoring = useIsRestoring();

  const { t } = useTranslation();
  const userLanguage = useLanguageStore((s) => s.language);
  const formattedLanguage = getTmdbLanguageCode(userLanguage);
  const releaseYearParams = useMemo(
    () =>
      releaseYear
        ? mediaType === "movie"
          ? { primary_release_year: releaseYear }
          : { first_air_date_year: releaseYear }
        : {},
    [mediaType, releaseYear],
  );
  const originCountryParams = useMemo(
    () => (originCountry ? { with_origin_country: originCountry } : {}),
    [originCountry],
  );
  const hasOriginCountryFilter = Boolean(originCountry);

  // Reset media when content type or media type changes
  useEffect(() => {
    if (contentType !== currentContentType) {
      setMedia([]);
      setCurrentContentType(contentType);
      setActualContentType(contentType); // Reset actual content type to original
    }
  }, [contentType, currentContentType]);

  const fetchTMDBMedia = useCallback(
    async (endpoint: string, params: Record<string, any> = {}) => {
      try {
        // For carousel views, we only need one page of results
        if (isCarouselView) {
          params.page = "1"; // Always use first page for carousels
        } else {
          params.page = page.toString(); // Use the requested page for "view more" pages
        }

        const data = await fetchCachedTmdb<any>(endpoint, {
          language: formattedLanguage,
          ...params,
        });

        const sortedResults = filterAndSortByQualityDesc(
          data.results ?? [],
          DEFAULT_MEDIA_QUALITY_THRESHOLD,
        );
        const results = isCarouselView
          ? sortedResults.slice(0, 20)
          : sortedResults;

        return {
          results: results.map((item: any) => ({
            ...item,
            type: mediaType === "movie" ? "movie" : "show",
          })),
          hasMore: page < data.total_pages,
        };
      } catch (err) {
        console.error("Error fetching TMDB media:", err);
        throw err;
      }
    },
    [formattedLanguage, page, mediaType, isCarouselView],
  );

  const filterResultsByReleaseYear = useCallback(
    (data: { results: DiscoverMedia[]; hasMore: boolean }) => {
      let results = data.results;

      if (releaseYear) {
        results = results.filter((item) => {
          const releaseDate =
            mediaType === "movie" ? item.release_date : item.first_air_date;
          return releaseDate?.startsWith(`${releaseYear}-`);
        });
      }

      if (originCountry) {
        results = results.filter((item: any) => {
          const countries: string[] | undefined = item.origin_country;
          return countries?.includes(originCountry);
        });
      }

      return { ...data, results };
    },
    [mediaType, releaseYear, originCountry],
  );

  const fetchEditorPicks = useCallback(async () => {
    const picks =
      mediaType === "movie" ? EDITOR_PICKS_MOVIES : EDITOR_PICKS_TV_SHOWS;

    // For carousel views, limit the number of picks to fetch
    const picksToFetch = isCarouselView ? picks.slice(0, 20) : picks;

    try {
      const mediaPromises = picksToFetch.map(async (item) => {
        const endpoint = `/${mediaType}/${item.id}`;
        const data = await fetchCachedTmdb<any>(endpoint, {
          language: formattedLanguage,
          append_to_response: "videos,images",
        });

        return {
          ...data,
          type: item.type,
        };
      });

      const results = await Promise.all(mediaPromises);
      return filterResultsByReleaseYear({
        results: filterAndSortByQualityDesc(
          results,
          DEFAULT_MEDIA_QUALITY_THRESHOLD,
        ),
        hasMore: picks.length > picksToFetch.length,
      });
    } catch (err) {
      console.error("Error fetching editor picks:", err);
      throw err;
    }
  }, [
    mediaType,
    formattedLanguage,
    isCarouselView,
    filterResultsByReleaseYear,
  ]);

  const fetchRecommendations = useCallback(
    async (mediaId: string) =>
      filterResultsByReleaseYear(
        await fetchTMDBMedia(`/${mediaType}/${mediaId}/recommendations`),
      ),
    [fetchTMDBMedia, filterResultsByReleaseYear, mediaType],
  );

  const fetchMedia = useCallback(async () => {
    if (isRestoring) return;

    // Skip fetching recommendations if no ID is provided
    if (contentType === "recommendations" && !id) {
      setIsLoading(false);
      setMedia([]);
      setHasMore(false);
      setSectionTitle("");
      return;
    }

    if (contentType === "provider" && !id) {
      setIsLoading(false);
      setError(null);
      return;
    }
    if (contentType === "genre" && !id) {
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const attemptFetch = async (type: DiscoverContentType) => {
      let data;

      // Map content types to their endpoints and handling logic
      switch (type) {
        case "popular":
          data =
            releaseYear || hasOriginCountryFilter
              ? await fetchTMDBMedia(`/discover/${mediaType}`, {
                  sort_by: "popularity.desc",
                  ...releaseYearParams,
                  ...originCountryParams,
                })
              : await fetchTMDBMedia(`/${mediaType}/popular`);
          setSectionTitle(t("discover.carousel.title.popular"));
          break;

        case "topRated":
          data =
            releaseYear || hasOriginCountryFilter
              ? await fetchTMDBMedia(`/discover/${mediaType}`, {
                  sort_by: "vote_average.desc",
                  "vote_count.gte": 200,
                  ...releaseYearParams,
                  ...originCountryParams,
                })
              : await fetchTMDBMedia(`/${mediaType}/top_rated`);
          setSectionTitle(t("discover.carousel.title.topRated"));
          break;

        case "onTheAir":
          if (mediaType === "tv") {
            data = await fetchTMDBMedia("/tv/on_the_air");
            setSectionTitle(t("discover.carousel.title.onTheAir"));
          } else {
            throw new Error("onTheAir is only available for TV shows");
          }
          break;

        case "nowPlaying":
          if (mediaType === "movie") {
            data =
              releaseYear || hasOriginCountryFilter
                ? await fetchTMDBMedia("/discover/movie", {
                    sort_by: "primary_release_date.desc",
                    ...releaseYearParams,
                    ...originCountryParams,
                  })
                : await fetchTMDBMedia("/movie/now_playing");
            setSectionTitle(t("discover.carousel.title.inCinemas"));
          } else {
            throw new Error("nowPlaying is only available for movies");
          }
          break;

        case "genre":
          if (!id) throw new Error("Genre ID is required");

          data = await fetchTMDBMedia(`/discover/${mediaType}`, {
            with_genres: id,
            ...releaseYearParams,
            ...originCountryParams,
          });
          setSectionTitle(
            mediaType === "movie"
              ? t("discover.carousel.title.movies", { category: genreName })
              : t("discover.carousel.title.tvshows", { category: genreName }),
          );
          break;

        case "provider":
          if (!id) throw new Error("Provider ID is required");

          // Use TMDB for watch providers
          data = await fetchTMDBMedia(`/discover/${mediaType}`, {
            with_watch_providers: id,
            watch_region: "US",
            ...releaseYearParams,
            ...originCountryParams,
          });
          if (data.results.length === 0 && formattedLanguage !== "en-US") {
            data = await fetchTMDBMedia(`/discover/${mediaType}`, {
              with_watch_providers: id,
              watch_region: "US",
              language: "en-US",
              ...releaseYearParams,
              ...originCountryParams,
            });
          }
          setSectionTitle(
            mediaType === "movie"
              ? t("discover.carousel.title.moviesOn", {
                  provider: providerName,
                })
              : t("discover.carousel.title.tvshowsOn", {
                  provider: providerName,
                }),
          );
          break;

        case "recommendations":
          if (!id) throw new Error("Media ID is required for recommendations");
          data = await fetchRecommendations(id);
          setSectionTitle(
            t("discover.carousel.title.recommended", { title: mediaTitle }),
          );
          break;

        case "editorPicks":
          data = await fetchEditorPicks();
          setSectionTitle(
            mediaType === "movie"
              ? t("discover.carousel.title.editorPicksMovies")
              : t("discover.carousel.title.editorPicksShows"),
          );
          break;

        case "trending":
          data = await fetchTMDBMedia(`/trending/${mediaType}/week`);
          setSectionTitle(t("discover.carousel.title.trending"));
          break;

        case "search":
          if (!mediaTitle) throw new Error("Search title is required");
          data = await fetchTMDBMedia(`/search/${mediaType}`, {
            query: mediaTitle,
            ...(releaseYear
              ? mediaType === "movie"
                ? { year: releaseYear }
                : { first_air_date_year: releaseYear }
              : {}),
          });
          setSectionTitle(t("discover.page.title"));
          break;

        case "top10":
          data =
            releaseYear || hasOriginCountryFilter
              ? await fetchTMDBMedia(`/discover/${mediaType}`, {
                  sort_by: "vote_average.desc",
                  "vote_count.gte": 200,
                  ...releaseYearParams,
                  ...originCountryParams,
                })
              : await fetchTMDBMedia(`/${mediaType}/top_rated`);
          setSectionTitle(t("discover.carousel.title.top10"));
          data.results = data.results.slice(0, 10);
          break;

        case "latest":
          data = await fetchTMDBMedia(
            mediaType === "movie" && (releaseYear || hasOriginCountryFilter)
              ? "/discover/movie"
              : mediaType === "movie"
                ? "/movie/now_playing"
                : releaseYear || hasOriginCountryFilter
                  ? "/discover/tv"
                  : "/tv/on_the_air",
            mediaType === "movie" && (releaseYear || hasOriginCountryFilter)
              ? {
                  sort_by: "primary_release_date.desc",
                  ...releaseYearParams,
                  ...originCountryParams,
                }
              : mediaType === "tv" && (releaseYear || hasOriginCountryFilter)
                ? {
                    sort_by: "first_air_date.desc",
                    ...releaseYearParams,
                    ...originCountryParams,
                  }
                : undefined,
          );
          setSectionTitle(t("discover.carousel.title.latestReleases"));
          break;

        case "latest4k":
          data =
            releaseYear || hasOriginCountryFilter
              ? await fetchTMDBMedia(`/discover/${mediaType}`, {
                  sort_by: "vote_average.desc",
                  "vote_count.gte": 200,
                  ...releaseYearParams,
                  ...originCountryParams,
                })
              : await fetchTMDBMedia(`/${mediaType}/top_rated`);
          setSectionTitle(t("discover.carousel.title.4kReleases"));
          data.results = data.results.slice(0, 20);
          break;

        case "latesttv":
          data =
            releaseYear || hasOriginCountryFilter
              ? await fetchTMDBMedia("/discover/tv", {
                  sort_by: "first_air_date.desc",
                  ...releaseYearParams,
                  ...originCountryParams,
                })
              : await fetchTMDBMedia("/tv/on_the_air");
          setSectionTitle(t("discover.carousel.title.latestTVReleases"));
          break;

        default:
          throw new Error(`Unsupported content type: ${type}`);
      }

      return filterResultsByReleaseYear(data);
    };

    try {
      const data = await attemptFetch(contentType);
      setMedia((prevMedia) => {
        const mergedMedia =
          page === 1 ? data.results : [...prevMedia, ...data.results];
        return filterAndSortByQualityDesc(
          mergedMedia,
          DEFAULT_MEDIA_QUALITY_THRESHOLD,
        );
      });
      setHasMore(data.hasMore);
    } catch (err) {
      console.error("Error fetching media:", err);
      setError((err as Error).message);

      // Try fallback content type if available
      if (fallbackType && fallbackType !== contentType) {
        console.info(`Falling back from ${contentType} to ${fallbackType}`);
        try {
          const fallbackData = await attemptFetch(fallbackType);
          setActualContentType(fallbackType); // Set actual content type to fallback
          setMedia((prevMedia) => {
            const mergedMedia =
              page === 1
                ? fallbackData.results
                : [...prevMedia, ...fallbackData.results];
            return filterAndSortByQualityDesc(
              mergedMedia,
              DEFAULT_MEDIA_QUALITY_THRESHOLD,
            );
          });
          setHasMore(fallbackData.hasMore);
          setError(null); // Clear error if fallback succeeds
        } catch (fallbackErr) {
          console.error("Error fetching fallback media:", fallbackErr);
          setError((fallbackErr as Error).message);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [
    contentType,
    mediaType,
    id,
    fallbackType,
    releaseYear,
    releaseYearParams,
    originCountryParams,
    hasOriginCountryFilter,
    genreName,
    providerName,
    mediaTitle,
    fetchTMDBMedia,
    filterResultsByReleaseYear,
    fetchEditorPicks,
    fetchRecommendations,
    t,
    page,
    formattedLanguage,
    isRestoring,
  ]);

  useEffect(() => {
    if (isRestoring) {
      setIsLoading(true);
      return;
    }
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    // Reset media when content type, media type, or id changes
    if (contentType !== currentContentType || page === 1) {
      setMedia([]);
      setCurrentContentType(contentType);
    }
    fetchMedia();
  }, [
    fetchMedia,
    contentType,
    currentContentType,
    page,
    id,
    enabled,
    isRestoring,
  ]);

  return {
    media,
    isLoading,
    error,
    hasMore,
    refetch: fetchMedia,
    sectionTitle,
    actualContentType,
  };
}
