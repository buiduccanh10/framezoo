import { filterDiscoverPayloadByTakedown, getActiveTakedownBlocklist } from '~/utils/takedown';

const DISCOVER_CACHE_KEY = 'discover:home:v1';
const DISCOVER_CACHE_TTL_SEC = 60 * 60;

type DiscoverItem = Record<string, unknown> & { vote_average?: number };
type DiscoverListResponse = { results: DiscoverItem[] };
type TmdbDiscoverClient = {
  movies: {
    popular: (query: Record<string, unknown>) => Promise<DiscoverListResponse>;
    topRated: (query: Record<string, unknown>) => Promise<DiscoverListResponse>;
    nowPlaying: (query: Record<string, unknown>) => Promise<DiscoverListResponse>;
  };
  tvShows: {
    popular: (query: Record<string, unknown>) => Promise<DiscoverListResponse>;
    topRated: (query: Record<string, unknown>) => Promise<DiscoverListResponse>;
    onTheAir: (query: Record<string, unknown>) => Promise<DiscoverListResponse>;
  };
  genres: {
    movies: (query: Record<string, unknown>) => Promise<unknown>;
    tvShows: (query: Record<string, unknown>) => Promise<unknown>;
  };
};

interface DiscoverPayload {
  popular: { movies: DiscoverItem[]; shows: DiscoverItem[] };
  topRated: { movies: DiscoverItem[]; shows: DiscoverItem[] };
  nowPlaying: { movies: DiscoverItem[]; shows: DiscoverItem[] };
  genres: { movies: unknown; shows: unknown };
  top10: { movies: DiscoverItem[]; shows: DiscoverItem[] };
  latesttv: { shows: DiscoverItem[] };
}

const sortByRating = (items: DiscoverItem[]): DiscoverItem[] =>
  items.sort((a, b) => Number(b.vote_average ?? 0) - Number(a.vote_average ?? 0));

async function fetchDiscoverPayload(): Promise<DiscoverPayload> {
  const client = tmdb as unknown as TmdbDiscoverClient;
  const popular = {
    movies: sortByRating((await client.movies.popular({})).results),
    shows: sortByRating((await client.tvShows.popular({})).results),
  };

  const topRatedMovies = sortByRating((await client.movies.topRated({})).results);
  const topRatedShows = sortByRating((await client.tvShows.topRated({})).results);

  const genres = {
    movies: await client.genres.movies({}),
    shows: await client.genres.tvShows({}),
  };
  const topRated = {
    movies: topRatedMovies,
    shows: topRatedShows,
  };
  const nowPlaying = {
    movies: sortByRating((await client.movies.nowPlaying({})).results),
    shows: sortByRating((await client.tvShows.onTheAir({})).results),
  };

  const top10 = {
    movies: topRatedMovies.slice(0, 10),
    shows: topRatedShows.slice(0, 10),
  };

  const latesttv = {
    shows: nowPlaying.shows,
  };

  return {
    popular,
    topRated,
    nowPlaying,
    genres,
    top10,
    latesttv,
  };
}

export default defineEventHandler(async () => {
  const blocklist = await getActiveTakedownBlocklist();
  const storage = process.env.NODE_ENV === 'production' ? useStorage('cache') : null;

  if (storage) {
    try {
      const cached =
        await storage.getItem<Awaited<ReturnType<typeof fetchDiscoverPayload>>>(DISCOVER_CACHE_KEY);
      if (cached) {
        return filterDiscoverPayloadByTakedown(cached, blocklist);
      }
    } catch {
      // Fall through to live fetch when cache is unavailable.
    }
  }

  const payload = await fetchDiscoverPayload();
  if (storage) {
    try {
      await storage.setItem(DISCOVER_CACHE_KEY, payload, { ttl: DISCOVER_CACHE_TTL_SEC });
    } catch {
      // Ignore cache write failures.
    }
  }

  return filterDiscoverPayloadByTakedown(payload, blocklist);
});
