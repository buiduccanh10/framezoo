import { fetchTextWithAwsWaf } from './aws-waf';

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

const imdbLanguageMap: Record<string, string> = {
  "en-US": "en-US",
  "es-ES": "es-ES",
  "fr-FR": "fr-FR",
  "de-DE": "de-DE",
  "it-IT": "it-IT",
  "pt-PT": "pt-PT",
  "ru-RU": "ru-RU",
  "ja-JP": "ja-JP",
  "zh-CN": "zh-CN",
  "ko-KR": "ko-KR",
  "ar-SA": "ar-SA",
  "hi-IN": "hi-IN",
  "el-GR": "el-GR",
};

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function getImdbLanguageCode(language?: string): string {
  if (!language) return "en-US";
  return imdbLanguageMap[language] || "en-US";
}

const IMDB_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

export async function scrapeIMDb(
  imdbId: string,
  season?: number,
  episode?: number,
  language?: string,
): Promise<IMDbMetadata> {
  const imdbLanguage = getImdbLanguageCode(language);

  let imdbUrl = `https://www.imdb.com/title/${imdbId}/`;
  if (season && episode) {
    imdbUrl += `episodes?season=${season}`;
  }

  const separator = imdbUrl.includes("?") ? "&" : "?";
  imdbUrl += `${separator}locale=${imdbLanguage}`;

  const html = await fetchTextWithAwsWaf(imdbUrl, {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': imdbLanguage,
    'User-Agent': IMDB_USER_AGENT,
  });
  const jsonMatch = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/,
  );
  if (!jsonMatch) {
    throw new Error("Could not find IMDb data on the page");
  }

  const data = JSON.parse(jsonMatch[1]);
  const metadata: IMDbMetadata = {
    title: "",
    original_title: "",
    title_type: "",
    year: null,
    end_year: null,
    day: null,
    month: null,
    date: "",
    runtime: null,
    age_rating: "",
    imdb_rating: null,
    votes: null,
    plot: "",
    poster_url: "",
    trailer_url: "",
    url: imdbUrl,
    genre: [],
    cast: [],
    directors: [],
    writers: [],
    keywords: [],
    countries: [],
    languages: [],
    locations: [],
    season,
    episode,
  };

  try {
    const aboveTheFold = data.props.pageProps.aboveTheFoldData;
    const mainColumn = data.props.pageProps.mainColumnData;

    metadata.title = aboveTheFold.titleText?.text || "";
    metadata.original_title = aboveTheFold.originalTitleText?.text || "";
    metadata.title_type = aboveTheFold.titleType?.text || "";
    metadata.age_rating = aboveTheFold.certificate?.rating || "";
    metadata.year = aboveTheFold.releaseYear?.year || null;
    metadata.end_year = aboveTheFold.releaseYear?.endYear || null;
    metadata.day = aboveTheFold.releaseDate?.day || null;
    metadata.month = aboveTheFold.releaseDate?.month || null;

    if (metadata.month && metadata.day && metadata.year) {
      metadata.date = `${months[metadata.month - 1]} ${metadata.day}, ${metadata.year}`;
    }

    metadata.runtime = aboveTheFold.runtime?.seconds || null;
    metadata.plot = aboveTheFold.plot?.plotText?.plainText || "";
    metadata.imdb_rating = aboveTheFold.ratingsSummary?.aggregateRating || null;
    metadata.votes = aboveTheFold.ratingsSummary?.voteCount || null;
    metadata.poster_url = aboveTheFold.primaryImage?.url || "";
    const trailerNode = aboveTheFold.primaryVideos?.edges?.[0]?.node;
    metadata.trailer_url = trailerNode?.playbackURLs?.[0]?.url || "";
    metadata.trailer_thumbnail = trailerNode?.thumbnail?.url || "";

    metadata.genre = aboveTheFold.genres?.genres?.map((genre: any) => genre.text) || [];
    metadata.cast =
      aboveTheFold.castPageTitle?.edges?.map((edge: any) => edge.node.name.nameText.text) || [];
    metadata.directors =
      aboveTheFold.directorsPageTitle?.[0]?.credits?.map((credit: any) => credit.name.nameText.text) ||
      [];
    metadata.writers =
      mainColumn.writers?.[0]?.credits?.map((credit: any) => credit.name.nameText.text) || [];
    metadata.keywords = aboveTheFold.keywords?.edges?.map((edge: any) => edge.node.text) || [];
    metadata.countries =
      mainColumn.countriesOfOrigin?.countries?.map((country: any) => country.text) || [];
    metadata.languages =
      mainColumn.spokenLanguages?.spokenLanguages?.map((spokenLanguage: any) => spokenLanguage.text) ||
      [];
    metadata.locations =
      mainColumn.filmingLocations?.edges?.map((edge: any) => edge.node.text) || [];

    if (season && episode) {
      const episodeData = data.props.pageProps.mainColumnData.episodes?.edges?.find(
        (entry: any) => entry.node.episodeNumber === episode,
      );

      if (episodeData) {
        metadata.episode_title = episodeData.node.titleText?.text || "";
        metadata.episode_plot = episodeData.node.plot?.plotText?.plainText || "";
        metadata.episode_rating = episodeData.node.ratingsSummary?.aggregateRating || null;
        metadata.episode_votes = episodeData.node.ratingsSummary?.voteCount || null;
      }
    }
  } catch (error) {
    console.error("Error parsing IMDb data:", error);
    throw error;
  }

  return metadata;
}
