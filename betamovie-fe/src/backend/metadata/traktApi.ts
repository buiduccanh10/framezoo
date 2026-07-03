import { ofetch } from "ofetch";

import { conf } from "@/setup/config";

import { getMediaDetails } from "./tmdb";
import { TMDBContentTypes, TMDBMovieData } from "./types/tmdb";
import type {
  CuratedMovieList,
  TraktListResponse,
  TraktNetworkResponse,
  TraktReleaseResponse,
} from "./types/trakt";

const FEED_PATH = "/discover/enrichment/feed";
const CURATED_PATH = "/discover/enrichment/curated";
const NETWORK_PATH = "/discover/enrichment/network";
const RELEASE_PATH = "/discover/enrichment/release";

async function fetchEnrichment<T>(
  path: string,
  query?: Record<string, string | number>,
): Promise<T> {
  const backendUrl = conf().BACKEND_URL;
  if (!conf().USE_TRAKT || !backendUrl) {
    return null as T;
  }

  return ofetch<T>(path, {
    baseURL: backendUrl,
    credentials: "include",
    query,
  });
}

async function fetchFeed(kind: string): Promise<TraktListResponse> {
  return fetchEnrichment<TraktListResponse>(FEED_PATH, { kind });
}

export const PROVIDER_TO_TRAKT_MAP = {
  "8": "netflixmovies",
  "8tv": "netflixtv",
  "2": "applemovie",
  "2tv": "appletv",
  "350tv": "appletv",
  "10": "primemovies",
  "10tv": "primetv",
  "15": "hulumovies",
  "15tv": "hulutv",
  "337": "disneymovies",
  "337tv": "disneytv",
  "1899": "hbomovies",
  "1899tv": "hbotv",
  "531": "paramountmovies",
  "531tv": "paramounttv",
} as const;

export const PROVIDER_TO_IMAGE_MAP: Record<string, string> = {
  Max: "max",
  "Prime Video": "prime",
  Netflix: "netflix",
  "Disney+": "disney",
  Hulu: "hulu",
  "Apple TV+": "appletv",
  "Paramount+": "paramount",
};

export const getLatestReleases = () => fetchFeed("latest");
export const getLatest4KReleases = () => fetchFeed("latest4k");
export const getLatestTVReleases = () => fetchFeed("latesttv");
export const getAppleTVReleases = () => fetchFeed("appletv");
export const getAppleMovieReleases = () => fetchFeed("applemovie");
export const getNetflixMovies = () => fetchFeed("netflixmovies");
export const getNetflixTVShows = () => fetchFeed("netflixtv");
export const getPrimeMovies = () => fetchFeed("primemovies");
export const getPrimeTVShows = () => fetchFeed("primetv");
export const getHuluMovies = () => fetchFeed("hulumovies");
export const getHuluTVShows = () => fetchFeed("hulutv");
export const getDisneyMovies = () => fetchFeed("disneymovies");
export const getDisneyTVShows = () => fetchFeed("disneytv");
export const getHBOMovies = () => fetchFeed("hbomovies");
export const getHBOTVShows = () => fetchFeed("hbotv");
export const getParamountMovies = () => fetchFeed("paramountmovies");
export const getParamountTVShows = () => fetchFeed("paramounttv");
export const getPopularTVShows = () => fetchFeed("populartv");
export const getPopularMovies = () => fetchFeed("popularmovies");
export const getTop10Movies = () => fetchFeed("top10");
export const getDiscoverContent = () => fetchFeed("discover");

export const getNetworkContent = (tmdbId: string, type: "movie" | "show") =>
  fetchEnrichment<TraktNetworkResponse>(NETWORK_PATH, {
    tmdbId,
    type,
  });

export const getCuratedMovieLists = async (): Promise<CuratedMovieList[]> => {
  const lists = await fetchEnrichment<CuratedMovieList[]>(CURATED_PATH);
  return Array.isArray(lists) ? lists : [];
};

export async function getReleaseDetails(
  tmdbId: string,
): Promise<TraktReleaseResponse> {
  return fetchEnrichment<TraktReleaseResponse>(RELEASE_PATH, { tmdbId });
}

export const getMovieDetailsForIds = async (
  tmdbIds: number[],
  limit: number = 50,
): Promise<TMDBMovieData[]> => {
  const limitedIds = tmdbIds.slice(0, limit);
  const movieDetails: TMDBMovieData[] = [];
  const batchSize = 10;
  const batchPromises: Promise<TMDBMovieData[]>[] = [];

  for (let index = 0; index < limitedIds.length; index += batchSize) {
    const batch = limitedIds.slice(index, index + batchSize);
    const batchPromise = Promise.all(
      batch.map(async (id) => {
        try {
          const details = await getMediaDetails(
            id.toString(),
            TMDBContentTypes.MOVIE,
          );
          return details as TMDBMovieData;
        } catch (error) {
          console.error(`Failed to fetch movie details for ID ${id}:`, error);
          return null;
        }
      }),
    ).then((batchResults) =>
      batchResults.filter((result): result is TMDBMovieData => result !== null),
    );
    batchPromises.push(batchPromise);
  }

  const batchResults = await Promise.all(batchPromises);
  movieDetails.push(...batchResults.flat());

  return movieDetails;
};
