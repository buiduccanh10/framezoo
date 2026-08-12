import { useIsRestoring } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  PROVIDER_TO_TRAKT_MAP,
  getAppleMovieReleases,
  getAppleTVReleases,
  getDisneyMovies,
  getDisneyTVShows,
  getHBOMovies,
  getHBOTVShows,
  getHuluMovies,
  getHuluTVShows,
  getLatest4KReleases,
  getLatestReleases,
  getLatestTVReleases,
  getNetflixMovies,
  getNetflixTVShows,
  getParamountMovies,
  getParamountTVShows,
  getPrimeMovies,
  getPrimeTVShows,
  getTop10Movies,
} from "@/backend/metadata/traktApi";
import { paginateResults } from "@/backend/metadata/traktFunctions";
import type { TraktListResponse } from "@/backend/metadata/types/trakt";
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
  DiscoverMediaType,
  Genre,
  MediaType,
  Provider,
  UseDiscoverMediaProps,
  UseDiscoverMediaReturn,
} from "@/pages/discover/types/discover";
import { conf } from "@/setup/config";
import { useLanguageStore } from "@/stores/language";
import { getTmdbLanguageCode } from "@/utils/language";
import { fetchCachedTmdb } from "@/utils/tmdbQuery";

const MIXED_MEDIA_TYPES: MediaType[] = ["movie", "tv"];

// Re-export types for backward compatibility
export type {
  Country,
  DiscoverContentType,
  DiscoverMedia,
  DiscoverMediaType,
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

function appendUniqueMedia(
  existingItems: DiscoverMedia[],
  incomingItems: DiscoverMedia[],
) {
  const seen = new Set(
    existingItems.map((item) => `${item.type || "unknown"}:${item.id}`),
  );
  const appendedItems = incomingItems.filter((item) => {
    const idStr = `${item.type || "unknown"}:${item.id}`;
    if (seen.has(idStr)) return false;
    seen.add(idStr);
    return true;
  });

  return [...existingItems, ...appendedItems];
}

export function useDiscoverOptions(
  mediaType: DiscoverMediaType,
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

  const providers =
    mediaType === "all"
      ? Array.from(
          new Map(
            [...MOVIE_PROVIDERS, ...TV_PROVIDERS].map((provider) => [
              provider.id,
              provider,
            ]),
          ).values(),
        )
      : mediaType === "movie"
        ? MOVIE_PROVIDERS
        : TV_PROVIDERS;

  useEffect(() => {
    const fetchOptions = async () => {
      if (isRestoring) return;

      setIsLoading(true);
      setError(null);

      try {
        const genreMediaTypes: MediaType[] =
          mediaType === "all" ? ["movie", "tv"] : [mediaType];
        const [genreResults, countriesData] = await Promise.all([
          Promise.all(
            genreMediaTypes.map((genreMediaType) =>
              fetchCachedTmdb<any>(`/genre/${genreMediaType}/list`, {
                language: formattedLanguage,
              }),
            ),
          ),
          includeCountries
            ? fetchCachedTmdb<any[]>("/configuration/countries")
            : [],
        ]);

        setGenres(
          Array.from(
            new Map(
              genreResults
                .flatMap((result) => result.genres || [])
                .map((genre: Genre) => [
                  genre.id,
                  {
                    ...genre,
                    name: t(`tmdb.genres.${genre.id}`, {
                      defaultValue: genre.name,
                    }),
                  },
                ]),
            ).values(),
          ).slice(0, 50),
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
  timeWindow,
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
  const lastFetchedRef = useRef<string>("");

  const { t } = useTranslation();
  const userLanguage = useLanguageStore((s) => s.language);
  const formattedLanguage = getTmdbLanguageCode(userLanguage);
  const releaseYearParams = useMemo(
    () =>
      releaseYear
        ? mediaType === "tv"
          ? { first_air_date_year: releaseYear }
          : { primary_release_year: releaseYear }
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

  const fetchTMDBMediaForType = useCallback(
    async (
      requestMediaType: MediaType,
      endpoint: string,
      params: Record<string, any> = {},
    ) => {
      try {
        const requestPage = isCarouselView ? 1 : page;
        const data = await fetchCachedTmdb<any>(endpoint, {
          language: formattedLanguage,
          ...params,
          page: requestPage.toString(),
        });

        const totalPages = data.total_pages ?? 1;
        const results = (data.results ?? []).slice(
          0,
          isCarouselView ? 20 : undefined,
        );

        return {
          results: results.map((item: any) => ({
            ...item,
            type: requestMediaType === "movie" ? "movie" : "show",
          })),
          hasMore: requestPage < totalPages,
        };
      } catch (err) {
        console.error("Error fetching TMDB media:", err);
        throw err;
      }
    },
    [formattedLanguage, isCarouselView, page],
  );

  const fetchTMDBMedia = useCallback(
    async (endpoint: string, params: Record<string, any> = {}) => {
      if (mediaType === "all") {
        throw new Error(`Mixed media requires explicit endpoints: ${endpoint}`);
      }

      return fetchTMDBMediaForType(mediaType, endpoint, params);
    },
    [fetchTMDBMediaForType, mediaType],
  );

  const fetchMixedMedia = useCallback(
    async (
      requests: Array<{
        mediaType: MediaType;
        endpoint: string;
        params?: Record<string, any>;
      }>,
      sortBy?: (a: DiscoverMedia, b: DiscoverMedia) => number,
    ) => {
      const responses = await Promise.all(
        requests.map(({ mediaType: requestMediaType, endpoint, params }) =>
          fetchTMDBMediaForType(requestMediaType, endpoint, params),
        ),
      );
      let results = appendUniqueMedia(
        [],
        responses.flatMap((response) => response.results),
      );
      if (sortBy) results = results.sort(sortBy);

      return {
        results: isCarouselView ? results.slice(0, 20) : results,
        hasMore: responses.some((response) => response.hasMore),
      };
    },
    [fetchTMDBMediaForType, isCarouselView],
  );

  const fetchTMDBMixedFeed = useCallback(
    async (endpoint: string) => {
      const requestPage = isCarouselView ? 1 : page;
      const data = await fetchCachedTmdb<any>(endpoint, {
        language: formattedLanguage,
        page: requestPage.toString(),
      });
      const results = (data.results ?? [])
        .filter(
          (item: any) =>
            item.media_type === "movie" || item.media_type === "tv",
        )
        .map((item: any) => ({
          ...item,
          type: item.media_type === "movie" ? "movie" : "show",
        }));

      return {
        results: isCarouselView ? results.slice(0, 20) : results,
        hasMore: requestPage < (data.total_pages ?? 1),
      };
    },
    [formattedLanguage, isCarouselView, page],
  );

  const fetchTraktMedia = useCallback(
    async (traktFunction: () => Promise<TraktListResponse>) => {
      try {
        const timeoutPromise = new Promise<TraktListResponse>((_, reject) => {
          setTimeout(() => reject(new Error("Trakt request timed out")), 3000);
        });

        const response = await Promise.race([traktFunction(), timeoutPromise]);
        if (!response) {
          throw new Error("Trakt API returned null response");
        }

        const pageSize = isCarouselView ? 20 : 100;
        const { tmdb_ids: tmdbIds, hasMore: hasMoreResults } = paginateResults(
          response,
          page,
          pageSize,
          mediaType === "movie" ? "movie" : "tv",
        );

        const idsToFetch = isCarouselView ? tmdbIds.slice(0, 20) : tmdbIds;
        const mediaPromises = idsToFetch.map(async (tmdbId: number) => {
          const endpoint = `/${mediaType}/${tmdbId}`;
          try {
            const data = await fetchCachedTmdb<any>(endpoint, {
              language: formattedLanguage,
            });

            return {
              ...data,
              type: mediaType === "movie" ? "movie" : "show",
            };
          } catch (err) {
            console.error(`Error fetching details for TMDB ID ${tmdbId}:`, err);
            return null;
          }
        });

        const settledResults = await Promise.allSettled(mediaPromises);
        const results = settledResults
          .filter(
            (result): result is PromiseFulfilledResult<DiscoverMedia | null> =>
              result.status === "fulfilled" && result.value !== null,
          )
          .map((result) => result.value);

        return {
          results,
          hasMore: hasMoreResults,
        };
      } catch (err) {
        console.error("Error fetching Trakt media:", err);
        throw err;
      }
    },
    [formattedLanguage, isCarouselView, mediaType, page],
  );

  const getTraktProviderFunction = useCallback(
    (providerId: string) => {
      const key = mediaType === "tv" ? `${providerId}tv` : providerId;
      const trakt =
        PROVIDER_TO_TRAKT_MAP[key as keyof typeof PROVIDER_TO_TRAKT_MAP];

      switch (trakt) {
        case "appletv":
          return getAppleTVReleases;
        case "applemovie":
          return getAppleMovieReleases;
        case "netflixmovies":
          return getNetflixMovies;
        case "netflixtv":
          return getNetflixTVShows;
        case "primemovies":
          return getPrimeMovies;
        case "primetv":
          return getPrimeTVShows;
        case "hulumovies":
          return getHuluMovies;
        case "hulutv":
          return getHuluTVShows;
        case "disneymovies":
          return getDisneyMovies;
        case "disneytv":
          return getDisneyTVShows;
        case "hbomovies":
          return getHBOMovies;
        case "hbotv":
          return getHBOTVShows;
        case "paramountmovies":
          return getParamountMovies;
        case "paramounttv":
          return getParamountTVShows;
        default:
          return null;
      }
    },
    [mediaType],
  );

  const filterResultsByReleaseYear = useCallback(
    (data: { results: DiscoverMedia[]; hasMore: boolean }) => {
      let results = data.results;

      if (releaseYear) {
        results = results.filter((item) => {
          const releaseDate =
            item.type === "movie" ? item.release_date : item.first_air_date;
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
    [releaseYear, originCountry],
  );

  const fetchEditorPicks = useCallback(async () => {
    const picks =
      mediaType === "movie"
        ? EDITOR_PICKS_MOVIES
        : mediaType === "tv"
          ? EDITOR_PICKS_TV_SHOWS
          : [...EDITOR_PICKS_MOVIES, ...EDITOR_PICKS_TV_SHOWS];

    // For carousel views, limit the number of picks to fetch
    const picksToFetch = isCarouselView ? picks.slice(0, 20) : picks;

    try {
      const mediaPromises = picksToFetch.map(async (item) => {
        const endpoint = `/${item.type === "movie" ? "movie" : "tv"}/${item.id}`;
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
        results,
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

    const currentFetchKey = `${contentType}-${mediaType}-${id || ""}-${page}-${releaseYear || ""}-${originCountry || ""}-${timeWindow || ""}`;
    if (lastFetchedRef.current === currentFetchKey) {
      return;
    }
    lastFetchedRef.current = currentFetchKey;

    setIsLoading(true);
    setError(null);

    const attemptFetch = async (type: DiscoverContentType) => {
      let data;

      // Map content types to their endpoints and handling logic
      switch (type) {
        case "popular":
          data =
            mediaType === "all"
              ? await fetchMixedMedia(
                  MIXED_MEDIA_TYPES.map((requestMediaType) => ({
                    mediaType: requestMediaType,
                    endpoint:
                      releaseYear || hasOriginCountryFilter
                        ? `/discover/${requestMediaType}`
                        : `/${requestMediaType}/popular`,
                    params:
                      releaseYear || hasOriginCountryFilter
                        ? {
                            sort_by: "popularity.desc",
                            ...(requestMediaType === "movie"
                              ? { primary_release_year: releaseYear }
                              : { first_air_date_year: releaseYear }),
                            ...originCountryParams,
                          }
                        : undefined,
                  })),
                  (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0),
                )
              : releaseYear || hasOriginCountryFilter
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
            mediaType === "all"
              ? await fetchMixedMedia(
                  MIXED_MEDIA_TYPES.map((requestMediaType) => ({
                    mediaType: requestMediaType,
                    endpoint:
                      releaseYear || hasOriginCountryFilter
                        ? `/discover/${requestMediaType}`
                        : `/${requestMediaType}/top_rated`,
                    params:
                      releaseYear || hasOriginCountryFilter
                        ? {
                            sort_by: "vote_average.desc",
                            "vote_count.gte": 200,
                            ...(requestMediaType === "movie"
                              ? { primary_release_year: releaseYear }
                              : { first_air_date_year: releaseYear }),
                            ...originCountryParams,
                          }
                        : undefined,
                  })),
                  (a, b) => {
                    const ratingDifference =
                      (b.vote_average ?? 0) - (a.vote_average ?? 0);
                    return (
                      ratingDifference ||
                      (b.vote_count ?? 0) - (a.vote_count ?? 0)
                    );
                  },
                )
              : releaseYear || hasOriginCountryFilter
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

          data =
            mediaType === "all"
              ? await fetchMixedMedia(
                  MIXED_MEDIA_TYPES.map((requestMediaType) => ({
                    mediaType: requestMediaType,
                    endpoint: `/discover/${requestMediaType}`,
                    params: {
                      with_genres: id,
                      ...(requestMediaType === "movie"
                        ? { primary_release_year: releaseYear }
                        : { first_air_date_year: releaseYear }),
                      ...originCountryParams,
                    },
                  })),
                  (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0),
                )
              : await fetchTMDBMedia(`/discover/${mediaType}`, {
                  with_genres: id,
                  ...releaseYearParams,
                  ...originCountryParams,
                });
          setSectionTitle(
            mediaType === "all"
              ? genreName || t("discover.carousel.title.popular")
              : mediaType === "movie"
                ? t("discover.carousel.title.movies", { category: genreName })
                : t("discover.carousel.title.tvshows", { category: genreName }),
          );
          break;

        case "provider": {
          if (!id) throw new Error("Provider ID is required");

          if (
            mediaType !== "all" &&
            conf().USE_TRAKT &&
            !releaseYear &&
            !hasOriginCountryFilter
          ) {
            {
              const traktProviderFunction = getTraktProviderFunction(id);
              if (traktProviderFunction) {
                try {
                  data = await fetchTraktMedia(traktProviderFunction);
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
                } catch (traktProviderError) {
                  console.warn(
                    "Falling back to TMDB provider discover:",
                    traktProviderError,
                  );
                }
              }
            }
          }

          const providerRequests =
            mediaType === "all"
              ? (["movie", "tv"] as MediaType[]).map((requestMediaType) => ({
                  mediaType: requestMediaType,
                  endpoint: `/discover/${requestMediaType}`,
                  params: {
                    with_watch_providers: id,
                    watch_region: "US",
                    ...(requestMediaType === "movie"
                      ? { primary_release_year: releaseYear }
                      : { first_air_date_year: releaseYear }),
                    ...originCountryParams,
                  },
                }))
              : [
                  {
                    mediaType,
                    endpoint: `/discover/${mediaType}`,
                    params: {
                      with_watch_providers: id,
                      watch_region: "US",
                      ...releaseYearParams,
                      ...originCountryParams,
                    },
                  },
                ];
          data =
            mediaType === "all"
              ? await fetchMixedMedia(
                  providerRequests,
                  (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0),
                )
              : await fetchTMDBMedia(
                  providerRequests[0]!.endpoint,
                  providerRequests[0]!.params,
                );
          if (data.results.length === 0 && formattedLanguage !== "en-US") {
            data =
              mediaType === "all"
                ? await fetchMixedMedia(
                    providerRequests.map((request) => ({
                      ...request,
                      params: {
                        ...request.params,
                        language: "en-US",
                      },
                    })),
                    (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0),
                  )
                : await fetchTMDBMedia(providerRequests[0]!.endpoint, {
                    ...providerRequests[0]!.params,
                    language: "en-US",
                  });
          }
          setSectionTitle(
            mediaType === "all"
              ? providerName || t("discover.carousel.title.popular")
              : mediaType === "movie"
                ? t("discover.carousel.title.moviesOn", {
                    provider: providerName,
                  })
                : t("discover.carousel.title.tvshowsOn", {
                    provider: providerName,
                  }),
          );
          break;
        }

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
            mediaType === "all"
              ? t("discover.carousel.title.editorPicks", {
                  defaultValue: "Editor's Picks",
                })
              : mediaType === "movie"
                ? t("discover.carousel.title.editorPicksMovies")
                : t("discover.carousel.title.editorPicksShows"),
          );
          break;

        case "trending":
          data =
            mediaType === "all"
              ? await fetchTMDBMixedFeed(`/trending/all/${timeWindow || "day"}`)
              : await fetchTMDBMedia(
                  `/trending/${mediaType}/${timeWindow || "day"}`,
                );
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
          if (
            conf().USE_TRAKT &&
            mediaType === "movie" &&
            !releaseYear &&
            !hasOriginCountryFilter
          ) {
            try {
              data = await fetchTraktMedia(getTop10Movies);
            } catch (traktTop10Error) {
              console.warn("Falling back to TMDB top10:", traktTop10Error);
              data = await fetchTMDBMedia(`/${mediaType}/top_rated`);
            }
          } else {
            data =
              releaseYear || hasOriginCountryFilter
                ? await fetchTMDBMedia(`/discover/${mediaType}`, {
                    sort_by: "vote_average.desc",
                    "vote_count.gte": 200,
                    ...releaseYearParams,
                    ...originCountryParams,
                  })
                : await fetchTMDBMedia(`/${mediaType}/top_rated`);
          }
          setSectionTitle(t("discover.carousel.title.top10"));
          data.results = data.results.slice(0, 10);
          break;

        case "latest":
          if (mediaType === "all") {
            data = await fetchMixedMedia(
              MIXED_MEDIA_TYPES.map((requestMediaType) => ({
                mediaType: requestMediaType,
                endpoint:
                  releaseYear || hasOriginCountryFilter
                    ? `/discover/${requestMediaType}`
                    : requestMediaType === "movie"
                      ? "/movie/now_playing"
                      : "/tv/on_the_air",
                params:
                  releaseYear || hasOriginCountryFilter
                    ? {
                        sort_by:
                          requestMediaType === "movie"
                            ? "primary_release_date.desc"
                            : "first_air_date.desc",
                        ...(requestMediaType === "movie"
                          ? { primary_release_year: releaseYear }
                          : { first_air_date_year: releaseYear }),
                        ...originCountryParams,
                      }
                    : undefined,
              })),
              (a, b) => {
                const dateA =
                  a.type === "movie" ? a.release_date : a.first_air_date;
                const dateB =
                  b.type === "movie" ? b.release_date : b.first_air_date;
                return (
                  new Date(dateB || 0).getTime() -
                  new Date(dateA || 0).getTime()
                );
              },
            );
            setSectionTitle(t("discover.carousel.title.latestReleases"));
            break;
          }

          if (conf().USE_TRAKT && !releaseYear && !hasOriginCountryFilter) {
            try {
              data = await fetchTraktMedia(
                mediaType === "movie" ? getLatestReleases : getLatestTVReleases,
              );
              setSectionTitle(t("discover.carousel.title.latestReleases"));
              break;
            } catch (traktLatestError) {
              console.warn(
                "Falling back to TMDB latest releases:",
                traktLatestError,
              );
            }
          }

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
          if (
            conf().USE_TRAKT &&
            mediaType === "movie" &&
            !releaseYear &&
            !hasOriginCountryFilter
          ) {
            try {
              data = await fetchTraktMedia(getLatest4KReleases);
            } catch (traktLatest4kError) {
              console.warn(
                "Falling back to TMDB 4K releases:",
                traktLatest4kError,
              );
              data = await fetchTMDBMedia(`/${mediaType}/top_rated`);
            }
          } else {
            data =
              releaseYear || hasOriginCountryFilter
                ? await fetchTMDBMedia(`/discover/${mediaType}`, {
                    sort_by: "vote_average.desc",
                    "vote_count.gte": 200,
                    ...releaseYearParams,
                    ...originCountryParams,
                  })
                : await fetchTMDBMedia(`/${mediaType}/top_rated`);
          }
          setSectionTitle(t("discover.carousel.title.4kReleases"));
          data.results = data.results.slice(0, 20);
          break;

        case "latesttv":
          if (conf().USE_TRAKT && !releaseYear && !hasOriginCountryFilter) {
            try {
              data = await fetchTraktMedia(getLatestTVReleases);
            } catch (traktLatestTvError) {
              console.warn(
                "Falling back to TMDB latest TV releases:",
                traktLatestTvError,
              );
              data = await fetchTMDBMedia("/tv/on_the_air");
            }
          } else {
            data =
              releaseYear || hasOriginCountryFilter
                ? await fetchTMDBMedia("/discover/tv", {
                    sort_by: "first_air_date.desc",
                    ...releaseYearParams,
                    ...originCountryParams,
                  })
                : await fetchTMDBMedia("/tv/on_the_air");
          }
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
        if (page === 1) {
          return appendUniqueMedia([], data.results);
        }

        return appendUniqueMedia(prevMedia, data.results);
      });
      setHasMore(data.hasMore);
    } catch (err) {
      console.error("Error fetching media:", err);
      setError((err as Error).message);
      lastFetchedRef.current = ""; // Clear ref on error to allow retries

      // Try fallback content type if available
      if (fallbackType && fallbackType !== contentType) {
        console.info(`Falling back from ${contentType} to ${fallbackType}`);
        try {
          const fallbackData = await attemptFetch(fallbackType);
          setActualContentType(fallbackType); // Set actual content type to fallback
          setMedia((prevMedia) => {
            if (page === 1) {
              return appendUniqueMedia([], fallbackData.results);
            }

            return appendUniqueMedia(prevMedia, fallbackData.results);
          });
          setHasMore(fallbackData.hasMore);
          setError(null); // Clear error if fallback succeeds
        } catch (fallbackErr) {
          console.error("Error fetching fallback media:", fallbackErr);
          setError((fallbackErr as Error).message);
          lastFetchedRef.current = ""; // Clear ref on error to allow retries
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
    originCountry,
    originCountryParams,
    hasOriginCountryFilter,
    genreName,
    providerName,
    mediaTitle,
    fetchTMDBMedia,
    fetchTraktMedia,
    filterResultsByReleaseYear,
    fetchEditorPicks,
    fetchRecommendations,
    fetchMixedMedia,
    fetchTMDBMixedFeed,
    getTraktProviderFunction,
    t,
    page,
    formattedLanguage,
    isRestoring,
    timeWindow,
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
      lastFetchedRef.current = ""; // Reset ref on reset to allow loading page 1
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
