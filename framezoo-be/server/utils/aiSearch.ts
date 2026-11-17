import { tmdb } from '~/utils/tmdb';

export type AiSearchMediaType = 'movie' | 'tv' | 'all';

export interface AiSearchIntent {
  intent: 'discover' | 'title_lookup' | 'hybrid';
  mediaType: AiSearchMediaType;
  candidateTitles: string[];
  keywords: string[];
  genres: string[];
  originCountries: string[];
  originalLanguages: string[];
  yearFrom: number | null;
  yearTo: number | null;
  minRating: number | null;
  sortBy: 'popularity' | 'rating' | 'release_date';
  summary: string;
}

export interface AiTmdbResultItem {
  id: number;
  media_type: 'movie' | 'tv';
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  origin_country?: string[];
  vote_average?: number;
  overview?: string;
}

export interface TmdbSearchClient {
  fetch: (path: string, query: Record<string, unknown>) => Promise<unknown>;
}

const MOVIE_GENRE_IDS: Record<string, number> = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  mystery: 9648,
  romance: 10749,
  'science-fiction': 878,
  thriller: 53,
  war: 10752,
  western: 37,
  'action-adventure': 28,
  'sci-fi-fantasy': 878,
};

const TV_GENRE_IDS: Record<string, number> = {
  action: 10759,
  adventure: 10759,
  'action-adventure': 10759,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  kids: 10762,
  mystery: 9648,
  reality: 10764,
  'sci-fi-fantasy': 10765,
  'science-fiction': 10765,
  fantasy: 10765,
  soap: 10766,
  war: 10768,
  western: 37,
};

const MAX_RESULTS = 30;
const GATEWAY_TIMEOUT_MS = 15_000;

export function mapGenreSlugsToTmdbIds(slugs: string[], kind: 'movie' | 'tv'): number[] {
  const table = kind === 'movie' ? MOVIE_GENRE_IDS : TV_GENRE_IDS;
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const slug of slugs) {
    const id = table[slug.toLowerCase()];
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function mapSortBy(sortBy: AiSearchIntent['sortBy'], kind: 'movie' | 'tv'): string {
  if (sortBy === 'rating') return 'vote_average.desc';
  if (sortBy === 'release_date') {
    return kind === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc';
  }
  return 'popularity.desc';
}

function extractTmdbResults(payload: unknown, forcedKind?: 'movie' | 'tv'): AiTmdbResultItem[] {
  if (!payload || typeof payload !== 'object') return [];
  const rawResults = (payload as { results?: unknown }).results;
  if (!Array.isArray(rawResults)) return [];

  const items: AiTmdbResultItem[] = [];
  for (const entry of rawResults) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const rawId = Number(item.id);
    if (!Number.isInteger(rawId) || rawId <= 0) continue;

    const rawType = typeof item.media_type === 'string' ? item.media_type : forcedKind;
    if (rawType !== 'movie' && rawType !== 'tv') continue;

    items.push({
      id: rawId,
      media_type: rawType,
      title: typeof item.title === 'string' ? item.title : undefined,
      name: typeof item.name === 'string' ? item.name : undefined,
      poster_path: typeof item.poster_path === 'string' ? item.poster_path : null,
      backdrop_path: typeof item.backdrop_path === 'string' ? item.backdrop_path : null,
      release_date: typeof item.release_date === 'string' ? item.release_date : undefined,
      first_air_date: typeof item.first_air_date === 'string' ? item.first_air_date : undefined,
      genre_ids: Array.isArray(item.genre_ids)
        ? item.genre_ids.filter((id): id is number => typeof id === 'number')
        : undefined,
      origin_country: Array.isArray(item.origin_country)
        ? item.origin_country.filter((c): c is string => typeof c === 'string')
        : undefined,
      vote_average: typeof item.vote_average === 'number' ? item.vote_average : undefined,
      overview: typeof item.overview === 'string' ? item.overview : undefined,
    });
  }
  return items;
}

function buildDiscoverQuery(
  intent: AiSearchIntent,
  kind: 'movie' | 'tv',
  language: string
): Record<string, unknown> {
  const query: Record<string, unknown> = {
    language,
    page: 1,
    sort_by: mapSortBy(intent.sortBy, kind),
  };

  const genreIds = mapGenreSlugsToTmdbIds(intent.genres, kind);
  if (genreIds.length > 0) {
    // Use OR (|) when 3+ genres are requested so niche combinations don't collapse to 0 results.
    query.with_genres = genreIds.slice(0, 3).join(genreIds.length >= 3 ? '|' : ',');
  }
  if (intent.originCountries.length > 0) {
    query.with_origin_country = intent.originCountries.join('|');
  }
  if (intent.originalLanguages.length > 0 && intent.originCountries.length === 0) {
    query.with_original_language = intent.originalLanguages[0];
  }

  const datePrefix = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
  if (intent.yearFrom !== null) {
    query[`${datePrefix}.gte`] = `${intent.yearFrom}-01-01`;
  }
  if (intent.yearTo !== null) {
    query[`${datePrefix}.lte`] = `${intent.yearTo}-12-31`;
  }
  if (intent.minRating !== null) {
    query['vote_average.gte'] = intent.minRating;
    query['vote_count.gte'] = 50;
  } else if (intent.sortBy === 'rating') {
    query['vote_count.gte'] = 100;
  }

  return query;
}

async function searchTitleCandidates(
  client: TmdbSearchClient,
  titles: string[],
  mediaType: AiSearchMediaType,
  language: string
): Promise<AiTmdbResultItem[]> {
  if (titles.length === 0) return [];
  const path =
    mediaType === 'movie' ? '/search/movie' : mediaType === 'tv' ? '/search/tv' : '/search/multi';
  const forcedKind = mediaType === 'all' ? undefined : mediaType;

  const responses = await Promise.allSettled(
    titles.slice(0, 5).map(title => client.fetch(path, { query: title, language, page: 1 }))
  );

  const collected: AiTmdbResultItem[] = [];
  for (const res of responses) {
    if (res.status !== 'fulfilled') continue;
    collected.push(...extractTmdbResults(res.value, forcedKind).slice(0, 2));
  }
  return collected;
}

async function runDiscover(
  client: TmdbSearchClient,
  intent: AiSearchIntent,
  language: string
): Promise<AiTmdbResultItem[]> {
  const kinds: ('movie' | 'tv')[] =
    intent.mediaType === 'movie' ? ['movie'] : intent.mediaType === 'tv' ? ['tv'] : ['movie', 'tv'];

  const responses = await Promise.allSettled(
    kinds.map(kind =>
      client
        .fetch(`/discover/${kind}`, buildDiscoverQuery(intent, kind, language))
        .then(payload => extractTmdbResults(payload, kind))
    )
  );

  const lists = responses
    .filter((r): r is PromiseFulfilledResult<AiTmdbResultItem[]> => r.status === 'fulfilled')
    .map(r => r.value);

  // Interleave movie and TV discover lists when searching both so movies don't push all shows down.
  const merged: AiTmdbResultItem[] = [];
  const maxLen = Math.max(0, ...lists.map(list => list.length));
  for (let i = 0; i < maxLen; i += 1) {
    for (const list of lists) {
      if (list[i]) merged.push(list[i]);
    }
  }
  return merged;
}

export async function callAiGateway(params: {
  query: string;
  language: string;
  mediaType: AiSearchMediaType;
  gatewayUrl: string;
  gatewaySecret: string;
  fetchFn?: typeof fetch;
}): Promise<AiSearchIntent> {
  const fetchImpl = params.fetchFn ?? fetch;
  const endpoint = `${params.gatewayUrl.replace(/\/+$/, '')}/v1/search-intent`;

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${params.gatewaySecret}`,
    },
    body: JSON.stringify({
      query: params.query,
      language: params.language,
      mediaType: params.mediaType,
    }),
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`AI gateway returned ${response.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as { ok?: boolean; intent?: AiSearchIntent };
  if (!data?.ok || !data.intent) {
    throw new Error('AI gateway returned invalid payload');
  }
  return data.intent;
}

export async function executeAiSearch(params: {
  query: string;
  language: string;
  mediaType: AiSearchMediaType;
  gatewayUrl: string;
  gatewaySecret: string;
  tmdbClient?: TmdbSearchClient;
  fetchFn?: typeof fetch;
}): Promise<{ intent: AiSearchIntent; results: AiTmdbResultItem[] }> {
  const client = params.tmdbClient ?? tmdb;
  const intent = await callAiGateway(params);
  const tmdbLanguage = params.language || 'en-US';

  const shouldDiscover = intent.intent !== 'title_lookup' || intent.candidateTitles.length === 0;
  const [candidateItems, discoverItems] = await Promise.all([
    searchTitleCandidates(client, intent.candidateTitles, intent.mediaType, tmdbLanguage),
    shouldDiscover ? runDiscover(client, intent, tmdbLanguage) : Promise.resolve([]),
  ]);

  const combined: AiTmdbResultItem[] = [...candidateItems, ...discoverItems];

  if (combined.length < 5 && intent.keywords.length > 0) {
    const keywordPath =
      intent.mediaType === 'movie'
        ? '/search/movie'
        : intent.mediaType === 'tv'
          ? '/search/tv'
          : '/search/multi';
    const forcedKind = intent.mediaType === 'all' ? undefined : intent.mediaType;
    try {
      const payload = await client.fetch(keywordPath, {
        query: intent.keywords.slice(0, 2).join(' '),
        language: tmdbLanguage,
        page: 1,
      });
      combined.push(...extractTmdbResults(payload, forcedKind));
    } catch {
      // Non-fatal fallback
    }
  }

  const seen = new Set<string>();
  const deduped: AiTmdbResultItem[] = [];
  for (const item of combined) {
    const key = `${item.media_type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= MAX_RESULTS) break;
  }

  return { intent, results: deduped };
}
