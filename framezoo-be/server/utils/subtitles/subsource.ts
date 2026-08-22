import { normalizeLanguageCode } from './languages';
import type { StremioSubtitle, SubtitleSearchContext } from './types';

const SUBSOURCE_API_BASE_URL = 'https://api.subsource.net/api/v1';
const SUBSOURCE_SEASON_API_BASE_URL = 'https://api.subsource.net/v1';

type SubsourceSubtitleRecord = {
  subtitleId?: string | number;
  id?: string | number;
  subtitle_id?: string | number;
  _id?: string | number;
  language?: string;
  languageCode?: string;
  format?: string;
  releaseInfo?: string[] | string;
  release_info?: string;
  name?: string;
  caption?: string;
  download_url?: string;
  downloadUrl?: string;
  url?: string;
  link?: string;
  hearingImpaired?: boolean | string | number;
  hearing_impaired?: boolean | string | number;
  hi?: boolean | string | number;
};

type SubsourceMovieRecord = {
  id?: string | number;
  movieId?: string | number;
  link?: string;
  slug?: string;
};

type SubsourceMovieLookup = {
  movieId: string;
  slug: string | null;
};

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return [];
}

function extractSubsourceArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (!data || typeof data !== 'object') return [];

  const record = data as Record<string, unknown>;
  const subtitles = asArray<T>(record.subtitles);
  if (subtitles.length > 0) return subtitles;

  const results = asArray<T>(record.results);
  if (results.length > 0) return results;

  const dataField = asArray<T>(record.data);
  if (dataField.length > 0) return dataField;

  if (record.data && typeof record.data === 'object') {
    const nested = record.data as Record<string, unknown>;
    const nestedSubtitles = asArray<T>(nested.subtitles);
    if (nestedSubtitles.length > 0) return nestedSubtitles;

    const nestedResults = asArray<T>(nested.results);
    if (nestedResults.length > 0) return nestedResults;
  }

  return [];
}

function extractSubtitleId(subtitle: SubsourceSubtitleRecord): string | null {
  const rawId = subtitle.subtitleId ?? subtitle.id ?? subtitle.subtitle_id ?? subtitle._id;
  if (rawId == null) return null;
  return String(rawId);
}

function buildDisplayLabel(subtitle: SubsourceSubtitleRecord): string {
  if (Array.isArray(subtitle.releaseInfo) && subtitle.releaseInfo.length > 0) {
    return subtitle.releaseInfo.join(' / ');
  }

  if (typeof subtitle.releaseInfo === 'string' && subtitle.releaseInfo.trim()) {
    return subtitle.releaseInfo;
  }

  if (typeof subtitle.release_info === 'string' && subtitle.release_info.trim()) {
    return subtitle.release_info;
  }

  if (subtitle.name && subtitle.name.trim()) return subtitle.name;

  return 'SubSource';
}

function buildEpisodeSearchText(subtitle: SubsourceSubtitleRecord): string {
  const pieces = [
    buildDisplayLabel(subtitle),
    subtitle.release_info ?? '',
    subtitle.caption ?? '',
  ];

  return pieces.join(' ').toLowerCase();
}

function hasMatchingEpisodeLabel(
  subtitle: SubsourceSubtitleRecord,
  season: number,
  episode: number
): boolean {
  const label = buildEpisodeSearchText(subtitle);
  const patterns = [
    new RegExp(`s0*${season}e0*${episode}(?!\\d)`, 'i'),
    new RegExp(`${season}x0*${episode}(?!\\d)`, 'i'),
    new RegExp(`season\\s*0*${season}.*episode\\s*0*${episode}(?!\\d)`, 'i'),
    new RegExp(`\\bepisode\\s*0*${episode}(?!\\d)`, 'i'),
    new RegExp(`\\bep\\.?\\s*0*${episode}(?!\\d)`, 'i'),
  ];

  if (patterns.some(pattern => pattern.test(label))) return true;

  const seasonPackPattern = new RegExp(
    `(?:complete|full|pack|batch).*(?:season|s)\\s*0*${season}(?!\\d)`,
    'i'
  );
  return seasonPackPattern.test(label);
}

function extractSlugFromMovieRecord(movie: SubsourceMovieRecord): string | null {
  const directSlug = movie.slug?.trim();
  if (directSlug) return directSlug;

  const link = movie.link?.trim();
  if (!link) return null;

  const fromSubtitlesPath = link.match(/subtitles\/([^/?#]+)/i)?.[1];
  if (fromSubtitlesPath) return fromSubtitlesPath;

  try {
    const pathname = new URL(link).pathname;
    const parts = pathname.split('/').filter(Boolean);
    const subtitleIdx = parts.findIndex(part => part === 'subtitles');
    if (subtitleIdx >= 0 && parts[subtitleIdx + 1]) return parts[subtitleIdx + 1];

    const last = parts[parts.length - 1];
    if (last) return last;
  } catch {
    // Not a URL
  }

  const clean = link.replace(/^\/+|\/+$/g, '');
  if (!clean) return null;

  const segments = clean.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? null;
}

async function searchSubsourceMovie(
  imdbId: string,
  season: number | undefined,
  apiKey: string
): Promise<SubsourceMovieRecord[]> {
  const params = new URLSearchParams({
    searchType: 'imdb',
    imdb: imdbId,
  });

  if (season != null) params.set('season', String(season));

  const response = await fetch(`${SUBSOURCE_API_BASE_URL}/movies/search?${params.toString()}`, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: 'application/json',
      'x-api-key': apiKey,
      'api-key': apiKey,
    },
  });

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  return extractSubsourceArray<SubsourceMovieRecord>(payload);
}

async function searchSubsourceMovieByText(
  query: string,
  season: number | undefined,
  apiKey: string
): Promise<SubsourceMovieRecord[]> {
  const params = new URLSearchParams({
    searchType: 'text',
    q: query,
  });
  if (season != null) params.set('season', String(season));

  const response = await fetch(`${SUBSOURCE_API_BASE_URL}/movies/search?${params.toString()}`, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: 'application/json',
      'x-api-key': apiKey,
      'api-key': apiKey,
    },
  });

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  return extractSubsourceArray<SubsourceMovieRecord>(payload);
}

async function fetchSubsourceMovieLookup(
  context: SubtitleSearchContext,
  apiKey: string
): Promise<SubsourceMovieLookup | null> {
  const { imdbId, title, releaseYear, season } = context;
  const candidateSeasons = season == null ? [undefined] : [season, undefined];

  const resolveMovieLookup = (movies: SubsourceMovieRecord[]): SubsourceMovieLookup | null => {
    if (movies.length === 0) return null;
    const firstMovie = movies[0];
    const movieId = firstMovie?.id ?? firstMovie?.movieId;
    if (movieId == null) return null;
    return {
      movieId: String(movieId),
      slug: extractSlugFromMovieRecord(firstMovie),
    };
  };

  if (imdbId) {
    for (const currentSeason of candidateSeasons) {
      const movies = await searchSubsourceMovie(imdbId, currentSeason, apiKey);
      const lookup = resolveMovieLookup(movies);
      if (lookup) return lookup;
    }
  }

  if (title) {
    const queries = [title];
    if (releaseYear) queries.push(`${title} ${releaseYear}`);

    for (const query of queries) {
      for (const currentSeason of candidateSeasons) {
        const movies = await searchSubsourceMovieByText(query, currentSeason, apiKey);
        const lookup = resolveMovieLookup(movies);
        if (lookup) return lookup;
      }
    }
  }

  return null;
}

async function fetchSubsourceSubtitles(
  movieId: string,
  apiKey: string
): Promise<SubsourceSubtitleRecord[]> {
  const params = new URLSearchParams({
    movieId,
    sort: 'popular',
    limit: '500',
  });

  const headers = {
    accept: 'application/json',
    'x-api-key': apiKey,
    'api-key': apiKey,
  };

  const baseUrl = `${SUBSOURCE_API_BASE_URL}/subtitles?${params.toString()}`;
  let response = await fetch(baseUrl, {
    signal: AbortSignal.timeout(10_000),
    headers,
  });

  if (response.status === 404) {
    const fallbackUrl = `${SUBSOURCE_API_BASE_URL}/search?${params.toString()}`;
    response = await fetch(fallbackUrl, {
      signal: AbortSignal.timeout(10_000),
      headers,
    });
  }

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  return extractSubsourceArray<SubsourceSubtitleRecord>(payload);
}

async function fetchSubsourceSeasonSubtitles(
  slug: string,
  season: number
): Promise<SubsourceSubtitleRecord[]> {
  const response = await fetch(
    `${SUBSOURCE_SEASON_API_BASE_URL}/subtitles/${slug}/season-${season}?sort_by_date=false`,
    {
      signal: AbortSignal.timeout(10_000),
      headers: {
        accept: 'application/json',
      },
    }
  );

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  return extractSubsourceArray<SubsourceSubtitleRecord>(payload);
}

function filterSubtitlesForEpisode(
  rawSubtitles: SubsourceSubtitleRecord[],
  season: number,
  episode: number,
  seasonScopedSubtitles: SubsourceSubtitleRecord[]
): SubsourceSubtitleRecord[] {
  if (seasonScopedSubtitles.length === 0) {
    const matchedByLabel = rawSubtitles.filter(subtitle =>
      hasMatchingEpisodeLabel(subtitle, season, episode)
    );

    return matchedByLabel.length > 0 ? matchedByLabel : rawSubtitles;
  }

  const episodeScopedSubtitles = seasonScopedSubtitles.filter(subtitle =>
    hasMatchingEpisodeLabel(subtitle, season, episode)
  );

  const episodeScopedIds = new Set(
    episodeScopedSubtitles
      .map(subtitle => extractSubtitleId(subtitle))
      .filter((value): value is string => Boolean(value))
  );

  if (episodeScopedIds.size > 0) {
    const matchedById = rawSubtitles.filter(subtitle => {
      const id = extractSubtitleId(subtitle);
      return id != null && episodeScopedIds.has(id);
    });

    if (matchedById.length > 0) return matchedById;
  }

  const matchedByLabel = rawSubtitles.filter(subtitle =>
    hasMatchingEpisodeLabel(subtitle, season, episode)
  );

  if (matchedByLabel.length > 0) return matchedByLabel;

  return rawSubtitles;
}

export async function fetchSubsourceSubtitlesList(
  context: SubtitleSearchContext,
  apiKey?: string,
  downloadBaseUrl = '/addon/subtitles/download/subsource'
): Promise<StremioSubtitle[]> {
  const key = apiKey || process.env.SUBSOURCE_API_KEY;
  if (!key) {
    return [];
  }

  try {
    const movieLookup = await fetchSubsourceMovieLookup(context, key);
    if (!movieLookup) {
      return [];
    }

    const rawSubtitles = await fetchSubsourceSubtitles(movieLookup.movieId, key);
    let subtitlesForMapping = rawSubtitles;

    if (context.season != null && context.episode != null) {
      let seasonScopedSubtitles: SubsourceSubtitleRecord[] = [];

      if (movieLookup.slug) {
        try {
          seasonScopedSubtitles = await fetchSubsourceSeasonSubtitles(
            movieLookup.slug,
            context.season
          );
        } catch {
          // Fallback to raw subtitles
        }
      }

      subtitlesForMapping = filterSubtitlesForEpisode(
        rawSubtitles,
        context.season,
        context.episode,
        seasonScopedSubtitles
      );
    }

    const subtitles: StremioSubtitle[] = [];
    const seen = new Set<string>();

    for (const sub of subtitlesForMapping) {
      const subtitleId = extractSubtitleId(sub);
      if (!subtitleId) continue;

      const langCode = normalizeLanguageCode(sub.languageCode ?? sub.language);
      if (!langCode || langCode === 'unknown') continue;

      // Proxied download URL served by our backend
      const downloadUrl = `${downloadBaseUrl}/${subtitleId}`;
      if (seen.has(downloadUrl)) continue;
      seen.add(downloadUrl);

      const label = buildDisplayLabel(sub);
      const id = `subsource:${subtitleId}:${langCode}`;

      subtitles.push({
        id,
        url: downloadUrl,
        lang: langCode,
        label,
        source: 'subsource',
        type: 'srt',
        isHearingImpaired: Boolean(sub.hearingImpaired ?? sub.hearing_impaired ?? sub.hi),
      });
    }

    return subtitles;
  } catch (error) {
    console.warn('[subtitles:subsource] search failed:', error);
    return [];
  }
}
