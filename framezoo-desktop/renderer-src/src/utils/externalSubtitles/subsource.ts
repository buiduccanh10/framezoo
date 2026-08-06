import { labelToLanguageCode } from "@/lib/language";
import { conf } from "@/setup/config";
import { CaptionListItem } from "@/stores/player/slices/source";

const SUBSOURCE_API_BASE_URL = "https://api.subsource.net/api/v1";
const SUBSOURCE_SEASON_API_BASE_URL = "https://api.subsource.net/v1";

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

type SubsourceLookupInput = {
  imdbId?: string;
  title?: string;
  releaseYear?: number;
  season?: number;
};

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return [];
}

function extractSubsourceArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (!data || typeof data !== "object") return [];

  const record = data as Record<string, unknown>;
  const subtitles = asArray<T>(record.subtitles);
  if (subtitles.length > 0) return subtitles;

  const results = asArray<T>(record.results);
  if (results.length > 0) return results;

  const dataField = asArray<T>(record.data);
  if (dataField.length > 0) return dataField;

  if (record.data && typeof record.data === "object") {
    const nested = record.data as Record<string, unknown>;
    const nestedSubtitles = asArray<T>(nested.subtitles);
    if (nestedSubtitles.length > 0) return nestedSubtitles;

    const nestedResults = asArray<T>(nested.results);
    if (nestedResults.length > 0) return nestedResults;
  }

  return [];
}

function mapSubsourceLanguageToCode(
  value: string | undefined | null,
): string | null {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();
  const map: Record<string, string> = {
    english: "en",
    vietnamese: "vi",
    french: "fr",
    german: "de",
    spanish: "es",
    spanish_latin_america: "es",
    portuguese: "pt",
    brazilian_portuguese: "pt-br",
    italian: "it",
    japanese: "ja",
    korean: "ko",
    chinese: "zh",
    chinese_simplified: "zh-cn",
    chinese_traditional: "zh-tw",
    thai: "th",
    indonesian: "id",
    russian: "ru",
    dutch: "nl",
    polish: "pl",
    turkish: "tr",
    swedish: "sv",
    danish: "da",
    finnish: "fi",
    norwegian: "no",
    arabic: "ar",
    hindi: "hi",
    bengali: "bn",
    greek: "el",
    farsi_persian: "fa",
    malay: "ms",
  };

  if (map[normalized]) return map[normalized];

  const byLabel = labelToLanguageCode(normalized);
  if (byLabel) return byLabel;

  return null;
}

function toSubtitleType(format: unknown, url?: string): string | undefined {
  const normalized =
    typeof format === "string" ? format.trim().toLowerCase() : "";
  if (normalized) return normalized;

  if (!url) return undefined;
  try {
    const pathname = new URL(url).pathname;
    const fileName = pathname.split("/").pop() ?? "";
    if (!fileName.includes(".")) return undefined;
    const ext = fileName.split(".").pop()?.toLowerCase();
    return ext && ext !== fileName.toLowerCase() ? ext : undefined;
  } catch {
    return undefined;
  }
}

function toBooleanFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function extractSubtitleId(subtitle: SubsourceSubtitleRecord): string | null {
  const rawId =
    subtitle.subtitleId ?? subtitle.id ?? subtitle.subtitle_id ?? subtitle._id;
  if (rawId == null) return null;
  return String(rawId);
}

function buildSubsourceCaptionId(
  subtitle: SubsourceSubtitleRecord,
  url: string,
  language: string,
): string {
  const subtitleId = extractSubtitleId(subtitle) ?? "unknown";
  return `subsource:${subtitleId}:${language}:${url}`;
}

function buildDisplayLabel(subtitle: SubsourceSubtitleRecord): string {
  if (Array.isArray(subtitle.releaseInfo) && subtitle.releaseInfo.length > 0) {
    return subtitle.releaseInfo.join(" / ");
  }

  if (typeof subtitle.releaseInfo === "string" && subtitle.releaseInfo.trim()) {
    return subtitle.releaseInfo;
  }

  if (
    typeof subtitle.release_info === "string" &&
    subtitle.release_info.trim()
  ) {
    return subtitle.release_info;
  }

  if (subtitle.name && subtitle.name.trim()) return subtitle.name;

  return "SubSource";
}

function buildEpisodeSearchText(subtitle: SubsourceSubtitleRecord): string {
  const pieces = [
    buildDisplayLabel(subtitle),
    subtitle.release_info ?? "",
    subtitle.caption ?? "",
  ];

  return pieces.join(" ").toLowerCase();
}

function hasMatchingEpisodeLabel(
  subtitle: SubsourceSubtitleRecord,
  season: number,
  episode: number,
): boolean {
  const label = buildEpisodeSearchText(subtitle);
  const patterns = [
    new RegExp(`s0*${season}e0*${episode}(?!\\d)`, "i"),
    new RegExp(`${season}x0*${episode}(?!\\d)`, "i"),
    new RegExp(`season\\s*0*${season}.*episode\\s*0*${episode}(?!\\d)`, "i"),
    new RegExp(`\\bepisode\\s*0*${episode}(?!\\d)`, "i"),
    new RegExp(`\\bep\\.?\\s*0*${episode}(?!\\d)`, "i"),
  ];

  if (patterns.some((pattern) => pattern.test(label))) return true;

  const seasonPackPattern = new RegExp(
    `(?:complete|full|pack|batch).*(?:season|s)\\s*0*${season}(?!\\d)`,
    "i",
  );
  return seasonPackPattern.test(label);
}

function extractSlugFromMovieRecord(
  movie: SubsourceMovieRecord,
): string | null {
  const directSlug = movie.slug?.trim();
  if (directSlug) return directSlug;

  const link = movie.link?.trim();
  if (!link) return null;

  const fromSubtitlesPath = link.match(/subtitles\/([^/?#]+)/i)?.[1];
  if (fromSubtitlesPath) return fromSubtitlesPath;

  try {
    const pathname = new URL(link).pathname;
    const parts = pathname.split("/").filter(Boolean);
    const subtitleIdx = parts.findIndex((part) => part === "subtitles");
    if (subtitleIdx >= 0 && parts[subtitleIdx + 1])
      return parts[subtitleIdx + 1];

    const last = parts[parts.length - 1];
    if (last) return last;
  } catch {
    // Not a URL, continue parsing as raw slug/path.
  }

  const clean = link.replace(/^\/+|\/+$/g, "");
  if (!clean) return null;

  const segments = clean.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? null;
}

async function searchSubsourceMovie(
  imdbId: string,
  season: number | undefined,
  apiKey: string,
): Promise<SubsourceMovieRecord[]> {
  const params = new URLSearchParams({
    searchType: "imdb",
    imdb: imdbId,
  });

  if (season) params.set("season", String(season));

  const response = await fetch(
    `${SUBSOURCE_API_BASE_URL}/movies/search?${params.toString()}`,
    {
      headers: {
        accept: "application/json",
        "x-api-key": apiKey,
        "api-key": apiKey,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`SubSource movies/search returned ${response.status}`);
  }

  const payload = await response.json();
  return extractSubsourceArray<SubsourceMovieRecord>(payload);
}

function buildSubsourceTextQueries(
  title: string | undefined,
  releaseYear: number | undefined,
): string[] {
  const normalizedTitle = title?.trim().replace(/\s+/g, " ");
  if (!normalizedTitle) return [];

  const queries = new Set<string>();
  queries.add(normalizedTitle);
  if (releaseYear) queries.add(`${normalizedTitle} ${releaseYear}`);

  const parenthesesRemoved = normalizedTitle.replace(/\([^)]*\)/g, "").trim();
  if (parenthesesRemoved && parenthesesRemoved !== normalizedTitle) {
    queries.add(parenthesesRemoved);
    if (releaseYear) queries.add(`${parenthesesRemoved} ${releaseYear}`);
  }

  return Array.from(queries);
}

async function searchSubsourceMovieByText(
  query: string,
  season: number | undefined,
  apiKey: string,
): Promise<SubsourceMovieRecord[]> {
  const params = new URLSearchParams({
    searchType: "text",
    q: query,
  });
  if (season) params.set("season", String(season));

  const response = await fetch(
    `${SUBSOURCE_API_BASE_URL}/movies/search?${params.toString()}`,
    {
      headers: {
        accept: "application/json",
        "x-api-key": apiKey,
        "api-key": apiKey,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `SubSource movies/search(text) returned ${response.status}`,
    );
  }

  const payload = await response.json();
  return extractSubsourceArray<SubsourceMovieRecord>(payload);
}

async function fetchSubsourceMovieLookup(
  input: SubsourceLookupInput,
  apiKey: string,
): Promise<SubsourceMovieLookup | null> {
  const { imdbId, title, releaseYear, season } = input;
  const candidateSeasons =
    season == null
      ? [undefined]
      : ([season, undefined] satisfies Array<number | undefined>);

  const resolveMovieLookup = (
    movies: SubsourceMovieRecord[],
  ): SubsourceMovieLookup | null => {
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

  const textQueries = buildSubsourceTextQueries(title, releaseYear);
  for (const query of textQueries) {
    for (const currentSeason of candidateSeasons) {
      const movies = await searchSubsourceMovieByText(
        query,
        currentSeason,
        apiKey,
      );
      const lookup = resolveMovieLookup(movies);
      if (lookup) return lookup;
    }
  }

  return null;
}

async function fetchSubsourceSubtitles(
  movieId: string,
  apiKey: string,
): Promise<SubsourceSubtitleRecord[]> {
  const params = new URLSearchParams({
    movieId,
    sort: "popular",
    limit: "500",
  });

  const headers = {
    accept: "application/json",
    "x-api-key": apiKey,
    "api-key": apiKey,
  };

  const baseUrl = `${SUBSOURCE_API_BASE_URL}/subtitles?${params.toString()}`;
  let response = await fetch(baseUrl, { headers });

  if (response.status === 404) {
    const fallbackUrl = `${SUBSOURCE_API_BASE_URL}/search?${params.toString()}`;
    response = await fetch(fallbackUrl, { headers });
  }

  if (!response.ok) {
    throw new Error(`SubSource subtitles returned ${response.status}`);
  }

  const payload = await response.json();
  return extractSubsourceArray<SubsourceSubtitleRecord>(payload);
}

async function fetchSubsourceSeasonSubtitles(
  slug: string,
  season: number,
): Promise<SubsourceSubtitleRecord[]> {
  const response = await fetch(
    `${SUBSOURCE_SEASON_API_BASE_URL}/subtitles/${slug}/season-${season}?sort_by_date=false`,
    {
      headers: {
        accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`SubSource season subtitles returned ${response.status}`);
  }

  const payload = await response.json();
  return extractSubsourceArray<SubsourceSubtitleRecord>(payload);
}

function filterSubtitlesForEpisode(
  rawSubtitles: SubsourceSubtitleRecord[],
  season: number,
  episode: number,
  seasonScopedSubtitles: SubsourceSubtitleRecord[],
): SubsourceSubtitleRecord[] {
  if (seasonScopedSubtitles.length === 0) {
    const matchedByLabel = rawSubtitles.filter((subtitle) =>
      hasMatchingEpisodeLabel(subtitle, season, episode),
    );

    return matchedByLabel.length > 0 ? matchedByLabel : rawSubtitles;
  }

  const episodeScopedSubtitles = seasonScopedSubtitles.filter((subtitle) =>
    hasMatchingEpisodeLabel(subtitle, season, episode),
  );

  const episodeScopedIds = new Set(
    episodeScopedSubtitles
      .map((subtitle) => extractSubtitleId(subtitle))
      .filter((value): value is string => Boolean(value)),
  );

  if (episodeScopedIds.size > 0) {
    const matchedById = rawSubtitles.filter((subtitle) => {
      const id = extractSubtitleId(subtitle);
      return id != null && episodeScopedIds.has(id);
    });

    if (matchedById.length > 0) return matchedById;
  }

  const matchedByLabel = rawSubtitles.filter((subtitle) =>
    hasMatchingEpisodeLabel(subtitle, season, episode),
  );

  if (matchedByLabel.length > 0) return matchedByLabel;

  return rawSubtitles;
}

export async function scrapeSubsourceCaptions(
  input: SubsourceLookupInput,
  season?: number,
  episode?: number,
): Promise<CaptionListItem[]> {
  try {
    const apiKey = conf().SUBSOURCE_API_KEY;
    if (!apiKey) {
      console.warn(
        "SubSource API key is not configured; skipping subtitle search",
      );
      return [];
    }

    const movieLookup = await fetchSubsourceMovieLookup(
      {
        imdbId: input.imdbId,
        title: input.title,
        releaseYear: input.releaseYear,
        season: season ?? input.season,
      },
      apiKey,
    );
    if (!movieLookup) {
      console.info(
        `SubSource movie not found (imdb=${input.imdbId ?? "n/a"}, title=${input.title ?? "n/a"})`,
      );
      return [];
    }

    const rawSubtitles = await fetchSubsourceSubtitles(
      movieLookup.movieId,
      apiKey,
    );

    let subtitlesForMapping = rawSubtitles;
    if (season && episode) {
      let seasonScopedSubtitles: SubsourceSubtitleRecord[] = [];

      if (movieLookup.slug) {
        try {
          seasonScopedSubtitles = await fetchSubsourceSeasonSubtitles(
            movieLookup.slug,
            season,
          );
        } catch (seasonError) {
          console.warn(
            `SubSource season endpoint failed for slug ${movieLookup.slug}:`,
            seasonError,
          );
        }
      }

      subtitlesForMapping = filterSubtitlesForEpisode(
        rawSubtitles,
        season,
        episode,
        seasonScopedSubtitles,
      );
    }

    const captions: CaptionListItem[] = [];
    const seen = new Set<string>();

    for (const subtitle of subtitlesForMapping) {
      const subtitleId = extractSubtitleId(subtitle);
      const downloadUrl =
        subtitle.download_url ??
        subtitle.downloadUrl ??
        subtitle.url ??
        (subtitleId
          ? `${SUBSOURCE_API_BASE_URL}/subtitles/${subtitleId}/download`
          : undefined);

      if (!downloadUrl) continue;

      const languageCode = mapSubsourceLanguageToCode(
        subtitle.languageCode ?? subtitle.language,
      );
      if (!languageCode) continue;

      const detectedType = toSubtitleType(subtitle.format, downloadUrl);
      // SubSource download endpoint returns ZIP bundles; we unzip and consume
      // inner subtitle files, so expose UI type as SRT for consistency.
      const type = detectedType === "zip" ? "srt" : (detectedType ?? "srt");

      const caption: CaptionListItem = {
        id: buildSubsourceCaptionId(subtitle, downloadUrl, languageCode),
        language: languageCode,
        url: downloadUrl,
        type,
        needsProxy: false,
        opensubtitles: true,
        display: buildDisplayLabel(subtitle),
        source: "subsource",
        isHearingImpaired: toBooleanFlag(
          subtitle.hearingImpaired ??
            subtitle.hearing_impaired ??
            subtitle.hi ??
            false,
        ),
      };

      const identity = [
        caption.url,
        caption.language,
        caption.type ?? "",
        caption.display ?? "",
      ].join("::");

      if (seen.has(identity)) continue;
      seen.add(identity);
      captions.push(caption);
    }

    return captions;
  } catch (error) {
    console.error("Error fetching SubSource subtitles:", error);
    return [];
  }
}
