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
  logo_path?: string | null;
  overview?: string;
  vote_average?: number;
  vote_count?: number;
  release_date?: string;
  first_air_date?: string;
  number_of_seasons?: number;
  runtime?: number | null;
  episode_run_time?: number[];
  original_language?: string;
  external_ids?: { imdb_id?: string | null };
  genres?: Array<{ name?: string }>;
  belongs_to_collection?: {
    id?: number;
    name?: string;
    poster_path?: string | null;
    backdrop_path?: string | null;
  } | null;
}

interface SearchResponse {
  results?: SearchResult[];
}

export interface DiscoverGenre {
  id: string;
  name: string;
}

export interface NetworkMetadata {
  platforms: string[];
}

interface GenreResponse {
  genres?: Array<{ id?: number; name?: string }>;
}

interface RawSeason {
  id: number;
  season_number: number;
  name: string;
  episode_count?: number;
  overview?: string;
  air_date?: string;
  poster_path?: string | null;
  episodes?: Array<{
    id: number;
    episode_number: number;
    name: string;
    overview?: string;
    still_path?: string | null;
    air_date?: string;
    vote_average?: number;
    vote_count?: number;
  }>;
}

interface RawDetails extends SearchResult {
  seasons?: RawSeason[];
  external_ids?: { imdb_id?: string | null };
  images?: {
    logos?: Array<{ file_path?: string | null; iso_639_1?: string | null }>;
  };
  genres?: Array<{ name: string }>;
  credits?: {
    cast?: Array<{
      id: number;
      name: string;
      character?: string;
      profile_path?: string | null;
    }>;
    crew?: Array<{
      id: number;
      name: string;
      job?: string;
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
    logo: imageUrl('original', value.logo_path),
    overview: value.overview,
    rating: value.vote_average,
    voteCount: value.vote_count,
    numberOfSeasons: value.number_of_seasons,
    runtime:
      value.runtime ??
      (value.episode_run_time?.length ? value.episode_run_time[0] : undefined),
    language: value.original_language,
    imdbId: value.external_ids?.imdb_id ?? undefined,
    genres: value.genres
      ?.map(genre => genre.name)
      .filter((name): name is string => Boolean(name)),
    collection:
      value.belongs_to_collection?.id && value.belongs_to_collection.name
        ? {
            id: String(value.belongs_to_collection.id),
            name: value.belongs_to_collection.name,
            poster: imageUrl('w342', value.belongs_to_collection.poster_path),
            backdrop: imageUrl(
              'w780',
              value.belongs_to_collection.backdrop_path,
            ),
          }
        : undefined,
  };
}

function selectLogo(
  logos:
    | Array<{ file_path?: string | null; iso_639_1?: string | null }>
    | undefined,
) {
  if (!Array.isArray(logos)) return undefined;
  const preferred =
    logos.find(item => item?.iso_639_1 === 'en') ??
    logos.find(item => item?.iso_639_1 === null) ??
    logos[0];
  return preferred?.file_path
    ? imageUrl('original', preferred.file_path)
    : undefined;
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

export type DiscoverSection =
  | 'trending'
  | 'popular'
  | 'topRated'
  | 'latest'
  | 'genre';

export async function getDiscoverSection(
  baseUrl: string,
  section: DiscoverSection,
  mediaType: MediaType,
  filters: { year?: string; country?: string } = {},
  genreId?: string,
) {
  const tmdbType = mediaType === 'show' ? 'tv' : 'movie';
  const hasFilters = Boolean(filters.year || filters.country);
  const params = new URLSearchParams();
  const releaseYearKey =
    mediaType === 'show' ? 'first_air_date_year' : 'primary_release_year';
  const releaseDateKey =
    mediaType === 'show' ? 'first_air_date.desc' : 'primary_release_date.desc';

  if (filters.year) params.set(releaseYearKey, filters.year);
  if (filters.country) params.set('with_origin_country', filters.country);

  let endpoint: string;
  let forcedType: 'movie' | 'tv' = mediaType === 'show' ? 'tv' : 'movie';

  if (section === 'genre') {
    endpoint = `/api/tmdb/discover/${tmdbType}`;
    if (genreId) params.set('with_genres', genreId);
  } else if (section === 'trending' && !hasFilters) {
    endpoint = `/api/tmdb/trending/${tmdbType}/day`;
  } else if (section === 'popular' && !hasFilters) {
    endpoint = `/api/tmdb/${tmdbType}/popular`;
  } else if (section === 'topRated' && !hasFilters) {
    endpoint = `/api/tmdb/${tmdbType}/top_rated`;
  } else if (section === 'latest' && !hasFilters) {
    endpoint =
      mediaType === 'show'
        ? '/api/tmdb/tv/on_the_air'
        : '/api/tmdb/movie/now_playing';
  } else {
    endpoint = `/api/tmdb/discover/${tmdbType}`;
    params.set(
      'sort_by',
      section === 'topRated'
        ? 'vote_average.desc'
        : section === 'latest'
        ? releaseDateKey
        : 'popularity.desc',
    );
    if (section === 'topRated') params.set('vote_count.gte', '200');
  }

  const path = params.size ? `${endpoint}?${params.toString()}` : endpoint;
  const response = await apiRequest<SearchResponse>(baseUrl, path);
  return (response.results ?? [])
    .filter(
      item => item.media_type === undefined || item.media_type === tmdbType,
    )
    .map(item => toMediaItem(item, forcedType));
}

export async function getFeaturedMedia(
  baseUrl: string,
  limit = 6,
): Promise<MediaItem[]> {
  const [dayResponse, weekResponse] = await Promise.all([
    apiRequest<SearchResponse>(baseUrl, '/api/tmdb/trending/all/day'),
    apiRequest<SearchResponse>(baseUrl, '/api/tmdb/trending/all/week'),
  ]);
  const seen = new Set<string>();
  const picks = [
    ...(dayResponse.results ?? []),
    ...(weekResponse.results ?? []),
  ]
    .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
    .filter(item => {
      const key = `${item.media_type}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);

  const details = await Promise.allSettled(
    picks.map(item =>
      getMediaDetails(
        baseUrl,
        String(item.id),
        item.media_type === 'tv' ? 'show' : 'movie',
        { appendToResponse: 'images,external_ids' },
      ),
    ),
  );

  return details.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    return toMediaItem(
      picks[index],
      picks[index].media_type === 'tv' ? 'tv' : 'movie',
    );
  });
}

export async function getNetworkContent(
  baseUrl: string,
  tmdbId: string,
  type: MediaType,
): Promise<NetworkMetadata | null> {
  const params = new URLSearchParams({
    tmdbId,
    type,
  });
  return apiRequest<NetworkMetadata | null>(
    baseUrl,
    `/discover/enrichment/network?${params.toString()}`,
  );
}

export async function getSimilarMedia(
  baseUrl: string,
  id: string,
  type: MediaType,
  limit = 12,
): Promise<MediaItem[]> {
  const response = await apiRequest<{ results?: SearchResult[] }>(
    baseUrl,
    `/api/tmdb/${type === 'show' ? 'tv' : 'movie'}/${encodeURIComponent(
      id,
    )}/recommendations`,
  );
  return (response.results ?? [])
    .map(item => toMediaItem(item, type === 'show' ? 'tv' : 'movie'))
    .filter(item => item.id !== id)
    .slice(0, limit);
}

export async function getMediaDetails(
  baseUrl: string,
  id: string,
  type: MediaType,
  options: { appendToResponse?: string } = {},
): Promise<MediaDetails> {
  const appendToResponse =
    options.appendToResponse ?? 'credits,videos,images,external_ids';
  const raw = await apiRequest<RawDetails>(
    baseUrl,
    `/api/tmdb/${type === 'show' ? 'tv' : 'movie'}/${encodeURIComponent(
      id,
    )}?append_to_response=${encodeURIComponent(appendToResponse)}`,
  );
  const item = toMediaItem({
    ...raw,
    media_type: type === 'show' ? 'tv' : 'movie',
  });
  item.logo = item.logo ?? selectLogo(raw.images?.logos);
  const directorCredit = raw.credits?.crew?.find(
    person => person.job === 'Director',
  );
  const cast = raw.credits?.cast?.slice(0, 11).map(person => ({
    id: String(person.id),
    name: person.name,
    character: person.character,
    image: imageUrl('w185', person.profile_path),
  }));
  const seasons: Season[] | undefined = raw.seasons?.map(season => ({
    id: String(season.id),
    number: season.season_number,
    title: season.name,
    episodeCount: season.episode_count,
    overview: season.overview,
    airDate: season.air_date,
    poster: imageUrl('w342', season.poster_path),
    episodes: (season.episodes ?? []).map(episode => ({
      id: String(episode.id),
      number: episode.episode_number,
      title: episode.name,
      overview: episode.overview,
      stillPath: imageUrl('w300', episode.still_path),
      airDate: episode.air_date,
      rating: episode.vote_average,
      voteCount: episode.vote_count,
    })),
  }));

  return {
    ...item,
    genres: raw.genres
      ?.map(genre => genre.name)
      .filter((name): name is string => Boolean(name)),
    seasons,
    imdbId: raw.external_ids?.imdb_id ?? undefined,
    director: directorCredit?.name,
    actors: raw.credits?.cast?.slice(0, 8).map(person => person.name),
    cast: [
      ...(directorCredit
        ? [
            {
              id: `director:${directorCredit.id}`,
              name: directorCredit.name,
              character: 'Director',
              image: imageUrl('w185', directorCredit.profile_path),
            },
          ]
        : []),
      ...(cast ?? []),
    ],
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

export interface IMDbRating {
  rating: number;
  votes: number;
  trailerUrl?: string;
  trailerThumbnail?: string;
}

export interface RottenTomatoesRating {
  title: string;
  tomatoIcon: 'certified_fresh' | 'fresh' | 'rotten';
  tomatoScore: number;
  popcornIcon?: 'upright' | 'spilled' | 'empty';
  popcornScore?: number;
  url: string;
}

export interface ExternalRatings {
  imdb: IMDbRating | null;
  rottenTomatoes: RottenTomatoesRating | null;
}

interface IMDbResponse {
  imdb_rating?: number | null;
  votes?: number | null;
  trailer_url?: string;
  trailer_thumbnail?: string;
}

export async function getIMDbRating(
  baseUrl: string,
  imdbId?: string,
  language?: string,
): Promise<IMDbRating | null> {
  if (!imdbId) return null;
  const params = new URLSearchParams({ imdbId });
  if (language) params.set('language', language);
  const response = await apiRequest<IMDbResponse>(
    baseUrl,
    `/imdb/title?${params.toString()}`,
  );
  if (
    typeof response.imdb_rating !== 'number' ||
    typeof response.votes !== 'number'
  ) {
    return null;
  }
  return {
    rating: response.imdb_rating,
    votes: response.votes,
    trailerUrl: response.trailer_url,
    trailerThumbnail: response.trailer_thumbnail,
  };
}

export async function getRottenTomatoesRating(
  baseUrl: string,
  title?: string,
  year?: number,
): Promise<RottenTomatoesRating | null> {
  if (!title) return null;
  const params = new URLSearchParams({ title });
  if (year) params.set('year', String(year));
  return apiRequest<RottenTomatoesRating | null>(
    baseUrl,
    `/rt/search?${params.toString()}`,
  );
}

export async function getExternalRatings(
  baseUrl: string,
  media: Pick<MediaItem, 'imdbId' | 'title' | 'year'>,
): Promise<ExternalRatings> {
  const [imdb, rottenTomatoes] = await Promise.allSettled([
    getIMDbRating(baseUrl, media.imdbId),
    getRottenTomatoesRating(baseUrl, media.title, media.year),
  ]);
  return {
    imdb: imdb.status === 'fulfilled' ? imdb.value : null,
    rottenTomatoes:
      rottenTomatoes.status === 'fulfilled' ? rottenTomatoes.value : null,
  };
}

interface RawSeasonDetails {
  episodes?: RawSeason['episodes'];
}

export async function getSeasonDetails(
  baseUrl: string,
  mediaId: string,
  seasonNumber: number,
): Promise<import('@/types').Episode[]> {
  const raw = await apiRequest<RawSeasonDetails>(
    baseUrl,
    `/api/tmdb/tv/${encodeURIComponent(mediaId)}/season/${seasonNumber}`,
  );
  return (raw.episodes ?? []).map(episode => ({
    id: String(episode.id),
    number: episode.episode_number,
    title: episode.name,
    overview: episode.overview,
    stillPath: imageUrl('w300', episode.still_path),
    airDate: episode.air_date,
    rating: episode.vote_average,
    voteCount: episode.vote_count,
  }));
}
