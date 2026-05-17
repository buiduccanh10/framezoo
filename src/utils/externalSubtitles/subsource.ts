import { labelToLanguageCode } from "@/lib/providers";
import { conf } from "@/setup/config";
import { useLanguageStore } from "@/stores/language";
import { CaptionListItem } from "@/stores/player/slices/source";
import { useSubtitleStore } from "@/stores/subtitles";

const SUBSOURCE_API_BASE_URL = "https://api.subsource.net/api/v1";

type SubsourceSubtitleRecord = {
  subtitleId?: string | number;
  id?: string | number;
  subtitle_id?: string | number;
  _id?: string | number;
  language?: string;
  languageCode?: string;
  format?: string;
  releaseInfo?: string[] | string;
  name?: string;
  download_url?: string;
  downloadUrl?: string;
  url?: string;
  hearingImpaired?: boolean | string | number;
  hearing_impaired?: boolean | string | number;
  hi?: boolean | string | number;
};

type SubsourceMovieRecord = {
  id?: string | number;
  movieId?: string | number;
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

function normalizeLanguageToSubsource(language?: string | null): string | null {
  if (!language) return null;

  const normalized = language.trim().toLowerCase().split("-")[0];
  const map: Record<string, string> = {
    en: "english",
    vi: "vietnamese",
    fr: "french",
    de: "german",
    es: "spanish",
    it: "italian",
    pt: "portuguese",
    ja: "japanese",
    ko: "korean",
    zh: "chinese",
    th: "thai",
    id: "indonesian",
    ru: "russian",
    nl: "dutch",
    pl: "polish",
    tr: "turkish",
    sv: "swedish",
    da: "danish",
    fi: "finnish",
    no: "norwegian",
    ar: "arabic",
    hi: "hindi",
    cs: "czech",
    ro: "romanian",
    hu: "hungarian",
    uk: "ukrainian",
    he: "hebrew",
    el: "greek",
    bg: "bulgarian",
    hr: "croatian",
    sr: "serbian",
    ms: "malay",
    et: "estonian",
    lv: "latvian",
    lt: "lithuanian",
    sk: "slovak",
    sl: "slovenian",
    bn: "bengali",
    tl: "tagalog",
    ka: "georgian",
    is: "icelandic",
    ca: "catalan",
    eu: "basque",
    gl: "galician",
    ta: "tamil",
    te: "telugu",
    ur: "urdu",
    pa: "punjabi",
    ne: "nepali",
    km: "khmer",
    my: "burmese",
    mn: "mongolian",
    fa: "farsi_persian",
  };

  return map[normalized] ?? null;
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
    const ext = pathname.split(".").pop()?.toLowerCase();
    return ext || undefined;
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

function buildSubsourceCaptionId(
  subtitle: SubsourceSubtitleRecord,
  url: string,
  language: string,
): string {
  const rawId =
    subtitle.subtitleId ?? subtitle.id ?? subtitle.subtitle_id ?? subtitle._id;
  const subtitleId = rawId != null ? String(rawId) : "unknown";
  return `subsource:${subtitleId}:${language}:${url}`;
}

function buildDisplayLabel(subtitle: SubsourceSubtitleRecord): string {
  if (Array.isArray(subtitle.releaseInfo) && subtitle.releaseInfo.length > 0) {
    return subtitle.releaseInfo.join(" / ");
  }

  if (typeof subtitle.releaseInfo === "string" && subtitle.releaseInfo.trim()) {
    return subtitle.releaseInfo;
  }

  if (subtitle.name && subtitle.name.trim()) return subtitle.name;

  return "SubSource";
}

function hasMatchingEpisodeLabel(
  subtitle: SubsourceSubtitleRecord,
  season: number,
  episode: number,
): boolean {
  const label = buildDisplayLabel(subtitle).toLowerCase();
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

async function fetchSubsourceMovieId(
  imdbId: string,
  season: number | undefined,
  apiKey: string,
): Promise<string | null> {
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
  const movies = extractSubsourceArray<SubsourceMovieRecord>(payload);
  if (movies.length === 0) return null;

  const movieId = movies[0]?.id ?? movies[0]?.movieId;
  if (movieId == null) return null;

  return String(movieId);
}

async function fetchSubsourceSubtitles(
  movieId: string,
  apiKey: string,
  preferredLanguage: string | null,
): Promise<SubsourceSubtitleRecord[]> {
  const params = new URLSearchParams({
    movieId,
    sort: "popular",
    limit: "100",
  });

  if (preferredLanguage) {
    const mappedPreferredLanguage =
      normalizeLanguageToSubsource(preferredLanguage);
    if (mappedPreferredLanguage) {
      params.set("language", mappedPreferredLanguage);
    }
  }

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

export async function scrapeSubsourceCaptions(
  imdbId: string,
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

    const preferredSubtitleLanguage =
      useSubtitleStore.getState().lastSelectedLanguage ??
      useLanguageStore.getState().language;

    const movieId = await fetchSubsourceMovieId(imdbId, season, apiKey);
    if (!movieId) {
      console.info(`SubSource movie not found for IMDb ID: ${imdbId}`);
      return [];
    }

    const rawSubtitles = await fetchSubsourceSubtitles(
      movieId,
      apiKey,
      preferredSubtitleLanguage,
    );

    const filteredByEpisode =
      season && episode
        ? rawSubtitles.filter((subtitle) =>
            hasMatchingEpisodeLabel(subtitle, season, episode),
          )
        : rawSubtitles;

    const subtitlesForMapping =
      season && episode && filteredByEpisode.length > 0
        ? filteredByEpisode
        : rawSubtitles;

    const captions: CaptionListItem[] = [];
    const seen = new Set<string>();

    for (const subtitle of subtitlesForMapping) {
      const downloadUrl =
        subtitle.download_url ?? subtitle.downloadUrl ?? subtitle.url;

      if (!downloadUrl) continue;

      const languageCode = mapSubsourceLanguageToCode(
        subtitle.languageCode ?? subtitle.language,
      );
      if (!languageCode) continue;

      const type = toSubtitleType(subtitle.format, downloadUrl);
      if (type === "zip") continue;
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
