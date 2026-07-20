import { $fetch } from 'ofetch';

import {
  isRetryableTmdbError,
  TMDB_FALLBACK_BASE_URL,
  TMDB_PRIMARY_BASE_URL,
  TMDB_RETRY_ATTEMPTS,
  TMDB_RETRY_DELAY_MS,
  TMDB_RETRY_STATUS_CODES,
  TMDB_TIMEOUT_MS,
} from '~/utils/tmdbConfig';

const TMDB_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

const resolveTmdbKey = () => {
  const config = useRuntimeConfig();
  return ((config.tmdbApiKey as string | undefined) || process.env.TMDB_API_KEY || '').trim();
};

const tmdbFetch = async (path: string, query: any) => {
  const tmdbKey = resolveTmdbKey();
  const headers: Record<string, string> = {
    'User-Agent': TMDB_USER_AGENT,
    Accept: 'application/json',
  };
  const finalQuery = {
    ...(query || {}),
    include_adult: false,
  };

  if (tmdbKey && tmdbKey.length > 50) {
    headers.Authorization = `Bearer ${tmdbKey}`;
    delete finalQuery.api_key;
  } else if (tmdbKey) {
    finalQuery.api_key = tmdbKey;
  }

  const fetchFromHost = (baseURL: string) =>
    $fetch(path, {
      baseURL,
      headers,
      query: finalQuery,
      retry: TMDB_RETRY_ATTEMPTS,
      retryDelay: TMDB_RETRY_DELAY_MS,
      retryStatusCodes: TMDB_RETRY_STATUS_CODES,
      timeout: TMDB_TIMEOUT_MS,
    });

  try {
    return await fetchFromHost(TMDB_PRIMARY_BASE_URL);
  } catch (error) {
    if (!isRetryableTmdbError(error)) {
      throw error;
    }

    return fetchFromHost(TMDB_FALLBACK_BASE_URL);
  }
};

/**
 * TMDB Client shim that matches the interface used by the crawler.
 * This replaces the tmdb-ts library for better control over the requests.
 */
export const tmdb = {
  fetch: (path: string, query: any) => tmdbFetch(path, query),
  genres: {
    movies: (query: any) => tmdbFetch('/genre/movie/list', query),
    tvShows: (query: any) => tmdbFetch('/genre/tv/list', query),
  },
  movies: {
    details: (movieId: string | number, query: any) => tmdbFetch(`/movie/${movieId}`, query),
    discover: (query: any) => tmdbFetch('/discover/movie', query),
    nowPlaying: (query: any) => tmdbFetch('/movie/now_playing', query),
    popular: (query: any) => tmdbFetch('/movie/popular', query),
    topRated: (query: any) => tmdbFetch('/movie/top_rated', query),
    releaseDates: (movieId: string | number, query: any) =>
      tmdbFetch(`/movie/${movieId}/release_dates`, query),
    watchProviders: (movieId: string | number, query: any) =>
      tmdbFetch(`/movie/${movieId}/watch/providers`, query),
  },
  tvShows: {
    discover: (query: any) => tmdbFetch('/discover/tv', query),
    popular: (query: any) => tmdbFetch('/tv/popular', query),
    topRated: (query: any) => tmdbFetch('/tv/top_rated', query),
    details: (tvId: string | number, query: any) => tmdbFetch(`/tv/${tvId}`, query),
    onTheAir: (query: any) => tmdbFetch('/tv/on_the_air', query),
    watchProviders: (tvId: string | number, query: any) =>
      tmdbFetch(`/tv/${tvId}/watch/providers`, query),
  },
  search: {
    movies: (query: any) => tmdbFetch('/search/movie', query),
    tvShows: (query: any) => tmdbFetch('/search/tv', query),
  },
  trending: {
    movies: (timeWindow: string, query: any) => tmdbFetch(`/trending/movie/${timeWindow}`, query),
    tvShows: (timeWindow: string, query: any) => tmdbFetch(`/trending/tv/${timeWindow}`, query),
    // Compatibility for older/different tmdb-ts versions
    movie: (timeWindow: string, query: any) => tmdbFetch(`/trending/movie/${timeWindow}`, query),
    tv: (timeWindow: string, query: any) => tmdbFetch(`/trending/tv/${timeWindow}`, query),
  },
};

export const tmdbUtils = {
  /**
   * Format TMDB poster path with proxy if configured
   */
  getPoster(path: string | null): string | undefined {
    if (!path) return undefined;
    const imgUrl = `https://image.tmdb.org/t/p/w342${path}`;
    return imgUrl;
  },

  /**
   * Format TMDB backdrop path with proxy if configured
   */
  getBackdrop(path: string | null): string | undefined {
    if (!path) return undefined;
    const imgUrl = `https://image.tmdb.org/t/p/original${path}`;
    return imgUrl;
  },

  /**
   * Common mapping for media items to be served to frontend
   */
  formatMedia(item: any, type: 'movie' | 'show') {
    return {
      id: item.id.toString(),
      title: item.title || item.name,
      year:
        item.release_date || item.first_air_date
          ? new Date(item.release_date || item.first_air_date).getFullYear()
          : 0,
      poster: this.getPoster(item.poster_path),
      backdrop: this.getBackdrop(item.backdrop_path),
      type,
      rating: item.vote_average,
      overview: item.overview,
    };
  },
};
