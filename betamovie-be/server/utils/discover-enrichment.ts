import { $fetch } from 'ofetch';

import { tmdb } from '~/utils/tmdb';

const DEFAULT_LANGUAGE = 'en-US';
const DEFAULT_REGION = 'US';
const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_DISCOVER_PAGES = [1, 2];
const LATEST_4K_CANDIDATE_PAGE_COUNT = 3;
const LATEST_4K_CANDIDATE_LIMIT = 40;
const SUPPORTED_PROVIDER_NAMES = [
  'Netflix',
  'Apple TV+',
  'Prime Video',
  'Hulu',
  'Disney+',
  'Max',
  'Paramount+',
] as const;

type SupportedProviderName = (typeof SUPPORTED_PROVIDER_NAMES)[number];

export interface EnrichmentListResponse {
  movie_tmdb_ids: number[];
  tv_tmdb_ids: number[];
  count: number;
}

export interface EnrichmentCuratedList {
  listName: string;
  listSlug: string;
  tmdbIds: number[];
  count: number;
}

export interface EnrichmentNetworkResponse {
  type: 'movie' | 'show';
  platforms: string[];
  count: number;
}

export interface EnrichmentReleaseResponse {
  tmdb_id: number;
  title: string;
  year?: number;
  type: 'movie';
  theatrical_release_date?: string;
  digital_release_date?: string;
}

type TmdbListPayload = {
  results?: Array<Record<string, any>>;
};

type TmdbProviderRegion = {
  flatrate?: Array<{ provider_name?: string }>;
  free?: Array<{ provider_name?: string }>;
  ads?: Array<{ provider_name?: string }>;
  buy?: Array<{ provider_name?: string }>;
  rent?: Array<{ provider_name?: string }>;
};

type TmdbProviderPayload = {
  results?: Record<string, TmdbProviderRegion>;
};

type TmdbMovieReleasePayload = {
  results?: Array<{
    iso_3166_1: string;
    release_dates?: Array<{
      certification?: string;
      release_date?: string;
      type?: number;
    }>;
  }>;
};

const PROVIDER_KIND_TO_DISCOVER: Record<
  string,
  { providerId: string; mediaType: 'movie' | 'tv' }
> = {
  applemovie: { providerId: '2', mediaType: 'movie' },
  appletv: { providerId: '350', mediaType: 'tv' },
  netflixmovies: { providerId: '8', mediaType: 'movie' },
  netflixtv: { providerId: '8', mediaType: 'tv' },
  primemovies: { providerId: '10', mediaType: 'movie' },
  primetv: { providerId: '10', mediaType: 'tv' },
  hulumovies: { providerId: '15', mediaType: 'movie' },
  hulutv: { providerId: '15', mediaType: 'tv' },
  disneymovies: { providerId: '337', mediaType: 'movie' },
  disneytv: { providerId: '337', mediaType: 'tv' },
  hbomovies: { providerId: '1899', mediaType: 'movie' },
  hbotv: { providerId: '1899', mediaType: 'tv' },
  paramountmovies: { providerId: '531', mediaType: 'movie' },
  paramounttv: { providerId: '531', mediaType: 'tv' },
};

const NETWORK_NAME_MAP: Record<string, SupportedProviderName> = {
  'amazon prime video': 'Prime Video',
  'apple tv+': 'Apple TV+',
  'disney plus': 'Disney+',
  'disney+': 'Disney+',
  hbo: 'Max',
  'hbo max': 'Max',
  hulu: 'Hulu',
  max: 'Max',
  netflix: 'Netflix',
  'paramount+': 'Paramount+',
  'paramount plus': 'Paramount+',
  'prime video': 'Prime Video',
};

const sortMediaItems = <T extends Record<string, any>>(items: T[]) =>
  [...items].sort((a, b) => {
    const voteAverageDiff = (Number(b.vote_average) || 0) - (Number(a.vote_average) || 0);
    if (voteAverageDiff !== 0) return voteAverageDiff;

    const voteCountDiff = (Number(b.vote_count) || 0) - (Number(a.vote_count) || 0);
    if (voteCountDiff !== 0) return voteCountDiff;

    const popularityDiff = (Number(b.popularity) || 0) - (Number(a.popularity) || 0);
    if (popularityDiff !== 0) return popularityDiff;

    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });

const uniqueIds = (ids: Array<number | null | undefined>) => {
  const seen = new Set<number>();
  const deduped: number[] = [];

  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push(id);
  }

  return deduped;
};

const listResponse = (movieIds: number[] = [], tvIds: number[] = []): EnrichmentListResponse => ({
  movie_tmdb_ids: uniqueIds(movieIds),
  tv_tmdb_ids: uniqueIds(tvIds),
  count: uniqueIds([...movieIds, ...tvIds]).length,
});

const extractIds = (payload: TmdbListPayload | null | undefined, limit = DEFAULT_PAGE_SIZE) =>
  uniqueIds((payload?.results || []).map(item => Number(item?.id) || null)).slice(0, limit);

const fetchMovieDiscoverIds = async (query: Record<string, any>, pages = DEFAULT_DISCOVER_PAGES) => {
  const payloads = await Promise.all(
    pages.map(page =>
      tmdb.movies.discover({
        language: DEFAULT_LANGUAGE,
        region: DEFAULT_REGION,
        include_adult: false,
        page,
        ...query,
      }) as Promise<TmdbListPayload>
    )
  );

  return uniqueIds(payloads.flatMap(payload => (payload.results || []).map(item => Number(item?.id) || null)));
};

const fetchMovieSearchIds = async (query: string, page = 1) => {
  const payload = (await tmdb.search.movies({
    language: DEFAULT_LANGUAGE,
    include_adult: false,
    query,
    page,
  })) as TmdbListPayload;

  return extractIds({ results: sortMediaItems(payload.results || []) });
};

const buildLatestFeed = async () => {
  const payload = (await tmdb.movies.nowPlaying({
    language: DEFAULT_LANGUAGE,
    region: DEFAULT_REGION,
    page: 1,
  })) as TmdbListPayload;

  return listResponse(extractIds(payload));
};

const buildLatestTvFeed = async () => {
  const payload = (await tmdb.tvShows.onTheAir({
    language: DEFAULT_LANGUAGE,
    page: 1,
  })) as TmdbListPayload;

  return listResponse([], extractIds(payload));
};

const buildDiscoverFeed = async () => {
  const [nowPlaying, popularMovies, topRatedMovies, onTheAir, popularShows, topRatedShows] =
    (await Promise.all([
      tmdb.movies.nowPlaying({ language: DEFAULT_LANGUAGE, region: DEFAULT_REGION, page: 1 }),
      tmdb.movies.popular({ language: DEFAULT_LANGUAGE, region: DEFAULT_REGION, page: 1 }),
      tmdb.movies.topRated({ language: DEFAULT_LANGUAGE, region: DEFAULT_REGION, page: 1 }),
      tmdb.tvShows.onTheAir({ language: DEFAULT_LANGUAGE, page: 1 }),
      tmdb.tvShows.popular({ language: DEFAULT_LANGUAGE, page: 1 }),
      tmdb.tvShows.topRated({ language: DEFAULT_LANGUAGE, page: 1 }),
    ])) as TmdbListPayload[];

  const movieIds = uniqueIds([
    ...extractIds(nowPlaying, 12),
    ...extractIds(popularMovies, 12),
    ...extractIds(topRatedMovies, 12),
  ]).slice(0, 20);
  const tvIds = uniqueIds([
    ...extractIds(onTheAir, 12),
    ...extractIds(popularShows, 12),
    ...extractIds(topRatedShows, 12),
  ]).slice(0, 20);

  return listResponse(movieIds, tvIds);
};

const getReleaseDateByTypes = (
  payload: TmdbMovieReleasePayload,
  types: number[],
) => {
  const preferredRegion =
    payload.results?.find(region => region.iso_3166_1 === DEFAULT_REGION) ||
    payload.results?.find(region => region.iso_3166_1 === 'GB') ||
    payload.results?.[0];

  if (!preferredRegion?.release_dates?.length) return undefined;

  const matchingDates = preferredRegion.release_dates
    .filter(entry => entry.release_date && typeof entry.type === 'number' && types.includes(entry.type))
    .map(entry => entry.release_date as string)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  return matchingDates[0];
};

const buildLatest4KFeed = async () => {
  const pages = Array.from({ length: LATEST_4K_CANDIDATE_PAGE_COUNT }, (_, index) => index + 1);
  const candidatePayloads = await Promise.all(
    pages.map(page =>
      tmdb.movies.discover({
        language: DEFAULT_LANGUAGE,
        region: DEFAULT_REGION,
        include_adult: false,
        sort_by: 'primary_release_date.desc',
        'primary_release_date.lte': new Date().toISOString().slice(0, 10),
        'vote_count.gte': 50,
        page,
      }) as Promise<TmdbListPayload>
    )
  );

  const candidateIds = uniqueIds(
    candidatePayloads.flatMap(payload => (payload.results || []).map(item => Number(item?.id) || null))
  ).slice(0, LATEST_4K_CANDIDATE_LIMIT);

  const datedCandidates = await Promise.all(
    candidateIds.map(async id => {
      try {
        const releaseDates = (await tmdb.movies.releaseDates(id, {})) as TmdbMovieReleasePayload;
        const date = getReleaseDateByTypes(releaseDates, [4, 5]);
        if (!date) return null;
        return { id, date };
      } catch {
        return null;
      }
    })
  );

  const sortedIds = datedCandidates
    .filter((item): item is { id: number; date: string } => item !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .map(item => item.id)
    .slice(0, DEFAULT_PAGE_SIZE);

  if (sortedIds.length > 0) {
    return listResponse(sortedIds);
  }

  return buildLatestFeed();
};

const buildTop10Feed = async () => {
  const payload = (await tmdb.movies.topRated({
    language: DEFAULT_LANGUAGE,
    region: DEFAULT_REGION,
    page: 1,
  })) as TmdbListPayload;

  return listResponse(extractIds(payload, 10));
};

const buildPopularMoviesFeed = async () => {
  const payload = (await tmdb.movies.popular({
    language: DEFAULT_LANGUAGE,
    region: DEFAULT_REGION,
    page: 1,
  })) as TmdbListPayload;

  return listResponse(extractIds(payload));
};

const buildPopularShowsFeed = async () => {
  const payload = (await tmdb.tvShows.popular({
    language: DEFAULT_LANGUAGE,
    page: 1,
  })) as TmdbListPayload;

  return listResponse([], extractIds(payload));
};

const buildProviderFeed = async (kind: string) => {
  const config = PROVIDER_KIND_TO_DISCOVER[kind];
  if (!config) {
    throw new Error(`Unsupported enrichment feed kind: ${kind}`);
  }

  const query = {
    language: DEFAULT_LANGUAGE,
    watch_region: DEFAULT_REGION,
    with_watch_providers: config.providerId,
    with_watch_monetization_types: 'flatrate|free|ads',
    sort_by: 'popularity.desc',
    include_adult: false,
    page: 1,
  };

  const payload =
    config.mediaType === 'movie'
      ? ((await tmdb.movies.discover(query)) as TmdbListPayload)
      : ((await tmdb.tvShows.discover(query)) as TmdbListPayload);

  const ids = extractIds(payload);
  return config.mediaType === 'movie' ? listResponse(ids) : listResponse([], ids);
};

const fallbackCuratedLists = async (): Promise<EnrichmentCuratedList[]> => {
  const [
    christmasIds,
    narrativeIds,
    topIds,
    hiddenGemIds,
    lgbtIds,
    mindfuckIds,
    trueStoryIds,
    halloweenIds,
  ] = await Promise.all([
    fetchMovieSearchIds('christmas'),
    fetchMovieDiscoverIds(
      {
        sort_by: 'vote_average.desc',
        'vote_count.gte': 4000,
      },
      [1, 2]
    ),
    fetchMovieDiscoverIds(
      {
        sort_by: 'vote_average.desc',
        'vote_count.gte': 1500,
        'primary_release_date.lte': '2000-12-31',
      },
      [1, 2]
    ),
    fetchMovieDiscoverIds(
      {
        sort_by: 'vote_average.desc',
        'vote_count.gte': 120,
        'vote_count.lte': 2500,
      },
      [1, 2]
    ),
    fetchMovieSearchIds('lgbt'),
    fetchMovieDiscoverIds(
      {
        sort_by: 'vote_average.desc',
        with_genres: '53,878,9648',
        'vote_count.gte': 300,
      },
      [1, 2]
    ),
    fetchMovieSearchIds('true story'),
    fetchMovieDiscoverIds(
      {
        sort_by: 'vote_average.desc',
        with_genres: '27',
        'vote_count.gte': 250,
      },
      [1, 2]
    ),
  ]);

  return [
    {
      listName: 'Top Rated Christmas Movies',
      listSlug: 'christmas',
      tmdbIds: christmasIds.slice(0, DEFAULT_PAGE_SIZE),
      count: Math.min(christmasIds.length, DEFAULT_PAGE_SIZE),
    },
    {
      listName: 'Letterboxd Top 250 Narrative Feature Films',
      listSlug: 'narrative',
      tmdbIds: narrativeIds.slice(0, DEFAULT_PAGE_SIZE),
      count: Math.min(narrativeIds.length, DEFAULT_PAGE_SIZE),
    },
    {
      listName: '1001 Greatest Movies of All Time',
      listSlug: 'top',
      tmdbIds: topIds.slice(0, DEFAULT_PAGE_SIZE),
      count: Math.min(topIds.length, DEFAULT_PAGE_SIZE),
    },
    {
      listName: 'Great Movies You May Have Never Heard Of',
      listSlug: 'never',
      tmdbIds: hiddenGemIds.slice(0, DEFAULT_PAGE_SIZE),
      count: Math.min(hiddenGemIds.length, DEFAULT_PAGE_SIZE),
    },
    {
      listName: 'LGBT Movies/Shows',
      listSlug: 'LGBTQ',
      tmdbIds: lgbtIds.slice(0, DEFAULT_PAGE_SIZE),
      count: Math.min(lgbtIds.length, DEFAULT_PAGE_SIZE),
    },
    {
      listName: 'Best Mindfuck Movies',
      listSlug: 'mindfuck',
      tmdbIds: mindfuckIds.slice(0, DEFAULT_PAGE_SIZE),
      count: Math.min(mindfuckIds.length, DEFAULT_PAGE_SIZE),
    },
    {
      listName: 'Based on a True Story Movies',
      listSlug: 'truestory',
      tmdbIds: trueStoryIds.slice(0, DEFAULT_PAGE_SIZE),
      count: Math.min(trueStoryIds.length, DEFAULT_PAGE_SIZE),
    },
    {
      listName: 'Halloween Movies',
      listSlug: 'halloween',
      tmdbIds: halloweenIds.slice(0, DEFAULT_PAGE_SIZE),
      count: Math.min(halloweenIds.length, DEFAULT_PAGE_SIZE),
    },
  ].filter(list => list.tmdbIds.length > 0);
};

export async function getEnrichmentFeed(kind: string) {
  switch (kind) {
    case 'discover':
      return buildDiscoverFeed();
    case 'latest':
      return buildLatestFeed();
    case 'latest4k':
      return buildLatest4KFeed();
    case 'latesttv':
      return buildLatestTvFeed();
    case 'top10':
      return buildTop10Feed();
    case 'popularmovies':
      return buildPopularMoviesFeed();
    case 'populartv':
      return buildPopularShowsFeed();
    default:
      return buildProviderFeed(kind);
  }
}

export async function getCuratedEnrichmentLists(event: any) {
  try {
    const requestUrl = getRequestURL(event);
    const response = await $fetch<any>('/letterboxd', {
      baseURL: requestUrl.origin,
    });

    const lists = (response?.lists || [])
      .filter((list: any) => Array.isArray(list?.tmdbMovies) && list.tmdbMovies.length > 0)
      .slice(0, 8)
      .map((list: any) => ({
        listName: list.listName,
        listSlug:
          list.listName
            ?.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'list',
        tmdbIds: uniqueIds(
          (list.tmdbMovies || []).map((movie: any) => Number(movie?.id) || null)
        ).slice(0, DEFAULT_PAGE_SIZE),
        count: Math.min(list.tmdbMovies?.length || 0, DEFAULT_PAGE_SIZE),
      }))
      .filter((list: EnrichmentCuratedList) => list.tmdbIds.length > 0);

    if (lists.length > 0) {
      return lists;
    }
  } catch (error) {
    console.warn('[Discover Enrichment] Letterboxd curated lists unavailable, using TMDB fallback.', error);
  }

  return fallbackCuratedLists();
}

const normalizeProviderName = (providerName?: string | null): SupportedProviderName | null => {
  if (!providerName) return null;
  const normalizedKey = providerName.trim().toLowerCase();
  return NETWORK_NAME_MAP[normalizedKey] || null;
};

const getFirstSupportedProvider = (regionData?: TmdbProviderRegion) => {
  if (!regionData) return null;

  const candidates = [
    ...(regionData.flatrate || []),
    ...(regionData.free || []),
    ...(regionData.ads || []),
    ...(regionData.buy || []),
    ...(regionData.rent || []),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeProviderName(candidate.provider_name);
    if (normalized) return normalized;
  }

  return null;
};

export async function getNetworkEnrichment(tmdbId: string, type: 'movie' | 'show') {
  const providerPayload =
    type === 'movie'
      ? ((await tmdb.movies.watchProviders(tmdbId, {})) as TmdbProviderPayload)
      : ((await tmdb.tvShows.watchProviders(tmdbId, {})) as TmdbProviderPayload);

  const firstRegion =
    providerPayload.results?.[DEFAULT_REGION] ||
    providerPayload.results?.GB ||
    Object.values(providerPayload.results || {})[0];

  const provider = getFirstSupportedProvider(firstRegion);
  if (provider) {
    return {
      type,
      platforms: [provider],
      count: 1,
    } satisfies EnrichmentNetworkResponse;
  }

  if (type === 'show') {
    const showDetails = (await tmdb.tvShows.details(tmdbId, {
      language: DEFAULT_LANGUAGE,
    })) as { networks?: Array<{ name?: string }> };

    const fallbackProvider = (showDetails.networks || [])
      .map(network => normalizeProviderName(network.name))
      .find((network): network is SupportedProviderName => Boolean(network));

    return {
      type,
      platforms: fallbackProvider ? [fallbackProvider] : [],
      count: fallbackProvider ? 1 : 0,
    } satisfies EnrichmentNetworkResponse;
  }

  return {
    type,
    platforms: [],
    count: 0,
  } satisfies EnrichmentNetworkResponse;
}

export async function getReleaseEnrichment(tmdbId: string) {
  const [movieDetails, releaseDates] = await Promise.all([
    tmdb.movies.details(tmdbId, { language: DEFAULT_LANGUAGE }) as Promise<{
      id: number;
      title?: string;
      release_date?: string;
    }>,
    tmdb.movies.releaseDates(tmdbId, {}) as Promise<TmdbMovieReleasePayload>,
  ]);

  const theatricalReleaseDate = getReleaseDateByTypes(releaseDates, [2, 3]);
  const digitalReleaseDate = getReleaseDateByTypes(releaseDates, [4, 5]);
  const year = movieDetails.release_date
    ? Number.parseInt(movieDetails.release_date.slice(0, 4), 10)
    : undefined;

  return {
    tmdb_id: movieDetails.id,
    title: movieDetails.title || '',
    year: Number.isFinite(year) ? year : undefined,
    type: 'movie',
    theatrical_release_date: theatricalReleaseDate,
    digital_release_date: digitalReleaseDate,
  } satisfies EnrichmentReleaseResponse;
}
