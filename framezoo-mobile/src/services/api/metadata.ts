import type { MediaDetails, MediaItem, MediaType, Season } from '@/types';

import { apiRequest } from './client';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/';

interface SearchResult {
  id: number;
  media_type?: 'movie' | 'tv';
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
}

interface SearchResponse {
  results?: SearchResult[];
}

export interface DiscoverGenre {
  id: string;
  name: string;
}

interface GenreResponse {
  genres?: Array<{ id?: number; name?: string }>;
}

interface RawSeason {
  id: number;
  season_number: number;
  name: string;
  episodes?: Array<{
    id: number;
    episode_number: number;
    name: string;
    overview?: string;
    still_path?: string | null;
    air_date?: string;
  }>;
}

interface RawDetails extends SearchResult {
  seasons?: RawSeason[];
  external_ids?: { imdb_id?: string | null };
  genres?: Array<{ name: string }>;
  credits?: {
    cast?: Array<{
      id: number;
      name: string;
      character?: string;
      profile_path?: string | null;
    }>;
  };
  videos?: {
    results?: Array<{
      id: string;
      name: string;
      key: string;
      site?: string;
      type?: string;
    }>;
  };
}

function imageUrl(size: string, path?: string | null) {
  return path ? `${TMDB_IMAGE_BASE}${size}${path}` : undefined;
}

function toMediaItem(
  value: SearchResult,
  forcedMediaType?: 'movie' | 'tv',
): MediaItem {
  const mediaType = forcedMediaType ?? value.media_type;
  const type: MediaType = mediaType === 'tv' ? 'show' : 'movie';
  const date = type === 'show' ? value.first_air_date : value.release_date;
  return {
    id: String(value.id),
    title:
      type === 'show' ? value.name ?? 'Untitled' : value.title ?? 'Untitled',
    type,
    year: date ? Number(date.slice(0, 4)) : undefined,
    releaseDate: date,
    poster: imageUrl('w342', value.poster_path),
    backdrop: imageUrl('w780', value.backdrop_path),
    overview: value.overview,
    rating: value.vote_average,
  };
}

export async function searchMedia(baseUrl: string, query: string) {
  const params = new URLSearchParams({
    query,
    include_adult: 'false',
    page: '1',
  });
  const response = await apiRequest<SearchResponse>(
    baseUrl,
    `/api/tmdb/search/multi?${params.toString()}`,
  );
  return (response.results ?? [])
    .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
    .map(item => toMediaItem(item));
}

export async function getDiscoverGenres(
  baseUrl: string,
): Promise<DiscoverGenre[]> {
  const response = await apiRequest<GenreResponse>(
    baseUrl,
    '/api/tmdb/genre/movie/list',
  );
  return (response.genres ?? [])
    .filter(genre => Number.isFinite(genre.id) && Boolean(genre.name))
    .map(genre => ({
      id: String(genre.id),
      name: genre.name as string,
    }));
}

export async function discoverMedia(
  baseUrl: string,
  category: 'movies' | 'tvshows' | 'popular' | 'top10' | `genre:${string}`,
  filters: { year?: string; country?: string } = {},
) {
  const genreId = category.startsWith('genre:')
    ? category.slice('genre:'.length)
    : '';
  const endpoint =
    category === 'tvshows'
      ? '/api/tmdb/discover/tv'
      : category === 'movies'
      ? '/api/tmdb/discover/movie'
      : genreId
      ? '/api/tmdb/discover/movie'
      : '/api/tmdb/trending/all/day';
  const params = new URLSearchParams();
  if (genreId) {
    params.set('with_genres', genreId);
  }
  if (filters.year && category !== 'popular' && category !== 'top10') {
    params.set(
      category === 'tvshows' ? 'first_air_date_year' : 'primary_release_year',
      filters.year,
    );
  }
  if (filters.country && category !== 'popular' && category !== 'top10') {
    params.set('with_origin_country', filters.country);
  }
  const path = params.size ? `${endpoint}?${params.toString()}` : endpoint;
  const response = await apiRequest<SearchResponse>(baseUrl, path);
  const forcedMediaType =
    category === 'tvshows'
      ? 'tv'
      : category === 'movies' || genreId
      ? 'movie'
      : undefined;
  return (response.results ?? [])
    .filter(
      item =>
        forcedMediaType !== undefined ||
        item.media_type === 'movie' ||
        item.media_type === 'tv',
    )
    .map(item => toMediaItem(item, forcedMediaType));
}

export async function getMediaDetails(
  baseUrl: string,
  id: string,
  type: MediaType,
): Promise<MediaDetails> {
  const raw = await apiRequest<RawDetails>(
    baseUrl,
    `/api/tmdb/${type === 'show' ? 'tv' : 'movie'}/${encodeURIComponent(id)}`,
  );
  const item = toMediaItem({
    ...raw,
    media_type: type === 'show' ? 'tv' : 'movie',
  });
  const seasons: Season[] | undefined = raw.seasons?.map(season => ({
    id: String(season.id),
    number: season.season_number,
    title: season.name,
    episodes: (season.episodes ?? []).map(episode => ({
      id: String(episode.id),
      number: episode.episode_number,
      title: episode.name,
      overview: episode.overview,
      stillPath: imageUrl('w300', episode.still_path),
      airDate: episode.air_date,
    })),
  }));

  return {
    ...item,
    genres: raw.genres?.map(genre => genre.name),
    seasons,
    imdbId: raw.external_ids?.imdb_id ?? undefined,
    cast: raw.credits?.cast?.slice(0, 12).map(person => ({
      id: String(person.id),
      name: person.name,
      character: person.character,
      image: imageUrl('w185', person.profile_path),
    })),
    trailers: raw.videos?.results
      ?.filter(video => video.site === 'YouTube' && video.type === 'Trailer')
      .slice(0, 6)
      .map(video => ({
        id: video.id,
        title: video.name,
        url: `https://www.youtube.com/watch?v=${video.key}`,
        thumbnail: `https://img.youtube.com/vi/${video.key}/hqdefault.jpg`,
      })),
  };
}
