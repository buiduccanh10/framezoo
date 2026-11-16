import {
  fetchOmdbJson,
  parseOmdbInteger,
  parseOmdbList,
  parseOmdbNumber,
  type OmdbTitleResponse,
} from './omdb';

export interface IMDbMetadata {
  title?: string;
  original_title?: string;
  title_type?: string;
  year?: number | null;
  end_year?: number | null;
  day?: number | null;
  month?: number | null;
  date?: string;
  runtime?: number | null;
  age_rating?: string;
  imdb_rating?: number | null;
  votes?: number | null;
  plot?: string;
  poster_url?: string;
  trailer_url?: string;
  trailer_thumbnail?: string;
  url?: string;
  genre?: string[];
  cast?: string[];
  directors?: string[];
  writers?: string[];
  keywords?: string[];
  countries?: string[];
  languages?: string[];
  locations?: string[];
  season?: number;
  episode?: number;
  episode_title?: string;
  episode_plot?: string;
  episode_rating?: number;
  episode_votes?: number;
}

function mapOmdbToImdbMetadata(
  imdbId: string,
  titleData: OmdbTitleResponse,
  episodeData?: OmdbTitleResponse,
  season?: number,
  episode?: number
): IMDbMetadata {
  const yearMatch = titleData.Year?.match(/^(\d{4})(?:[–-](\d{4}))?/);
  const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : null;
  const endYear = yearMatch?.[2] ? Number.parseInt(yearMatch[2], 10) : null;

  let day: number | null = null;
  let month: number | null = null;
  let formattedDate: string | undefined;
  if (titleData.Released && titleData.Released !== 'N/A') {
    const parsedDate = new Date(titleData.Released);
    if (!Number.isNaN(parsedDate.getTime())) {
      day = parsedDate.getUTCDate();
      month = parsedDate.getUTCMonth() + 1;
      formattedDate = titleData.Released;
    }
  }

  const runtime = parseOmdbInteger(titleData.Runtime);
  const imdbRating = parseOmdbNumber(titleData.imdbRating);
  const votes = parseOmdbInteger(titleData.imdbVotes);

  const metadata: IMDbMetadata = {
    title: titleData.Title && titleData.Title !== 'N/A' ? titleData.Title : undefined,
    original_title: titleData.Title && titleData.Title !== 'N/A' ? titleData.Title : undefined,
    title_type: titleData.Type && titleData.Type !== 'N/A' ? titleData.Type : undefined,
    year,
    end_year: endYear,
    day,
    month,
    date: formattedDate,
    runtime,
    age_rating: titleData.Rated && titleData.Rated !== 'N/A' ? titleData.Rated : undefined,
    imdb_rating: imdbRating,
    votes,
    plot: titleData.Plot && titleData.Plot !== 'N/A' ? titleData.Plot : undefined,
    poster_url: titleData.Poster && titleData.Poster !== 'N/A' ? titleData.Poster : undefined,
    url: `https://www.imdb.com/title/${imdbId}/`,
    genre: parseOmdbList(titleData.Genre),
    cast: parseOmdbList(titleData.Actors),
    directors: parseOmdbList(titleData.Director),
    writers: parseOmdbList(titleData.Writer),
    countries: parseOmdbList(titleData.Country),
    languages: parseOmdbList(titleData.Language),
  };

  if (season != null && episode != null) {
    metadata.season = season;
    metadata.episode = episode;
    if (episodeData && episodeData.Response === 'True') {
      if (episodeData.Title && episodeData.Title !== 'N/A') {
        metadata.episode_title = episodeData.Title;
      }
      if (episodeData.Plot && episodeData.Plot !== 'N/A') {
        metadata.episode_plot = episodeData.Plot;
      }
      const epRating = parseOmdbNumber(episodeData.imdbRating);
      if (epRating != null) metadata.episode_rating = epRating;
      const epVotes = parseOmdbInteger(episodeData.imdbVotes);
      if (epVotes != null) metadata.episode_votes = epVotes;
    }
  }

  return metadata;
}

export async function scrapeIMDb(
  imdbId: string,
  season?: number,
  episode?: number,
  _language?: string
): Promise<IMDbMetadata> {
  const cleanImdbId = imdbId.trim();
  const titleData = await fetchOmdbJson({ i: cleanImdbId, plot: 'full' });

  if (titleData.Response === 'False') {
    throw new Error(titleData.Error || `IMDb record ${cleanImdbId} not found in OMDb`);
  }

  let episodeData: OmdbTitleResponse | undefined;
  if (season != null && episode != null) {
    episodeData = await fetchOmdbJson({
      i: cleanImdbId,
      Season: season,
      Episode: episode,
      plot: 'full',
    }).catch(() => undefined);
  }

  return mapOmdbToImdbMetadata(cleanImdbId, titleData, episodeData, season, episode);
}
