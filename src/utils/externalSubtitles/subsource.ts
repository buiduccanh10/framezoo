/* eslint-disable no-console */
import { labelToLanguageCode } from "@p-stream/providers";
import { ofetch } from "ofetch";

import { get as getTmdb } from "@/backend/metadata/tmdb";
import { CaptionListItem } from "@/stores/player/slices/source";

interface SubSourceSearchResult {
  movieId: number;
  title: string;
  type: string;
  releaseYear: number;
  season?: number | null;
  imdbId?: string | null;
  tmdbId?: number | null;
}

interface SubSourceSearchResponse {
  success: boolean;
  data?: SubSourceSearchResult[];
}

interface SubSourceSubtitleResult {
  subtitleId: number;
  language: string;
  releaseInfo: string[];
  commentary?: string;
  rating?: Record<string, number>;
  downloads?: number;
}

interface SubSourceSubtitleResponse {
  success: boolean;
  data?: SubSourceSubtitleResult[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

const SUBSOURCE_PAGE_SIZE = 100;
const SUBSOURCE_MAX_TV_PAGES = 5;

function normalizeSubSourceLanguage(language: string): string {
  const normalized = language
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return labelToLanguageCode(normalized) || labelToLanguageCode(language) || "";
}

async function resolveImdbIdFromTmdb(
  tmdbId: number,
  mediaType: "movie" | "show",
): Promise<string | undefined> {
  try {
    const endpoint =
      mediaType === "show"
        ? `/tv/${tmdbId}/external_ids`
        : `/movie/${tmdbId}/external_ids`;
    const data = await getTmdb<{ imdb_id?: string | null }>(endpoint);

    return data.imdb_id ?? undefined;
  } catch (error) {
    console.warn("Failed to resolve IMDb ID from TMDB for SubSource:", error);
    return undefined;
  }
}

function createEpisodePatterns(season: number, episode: number): RegExp[] {
  const seasonPadded = season.toString().padStart(2, "0");
  const episodePadded = episode.toString().padStart(2, "0");

  return [
    new RegExp(`S${seasonPadded}E${episodePadded}`, "i"),
    new RegExp(`S${season}E${episodePadded}`, "i"),
    new RegExp(`S${seasonPadded}E${episode}`, "i"),
    new RegExp(`S${season}E${episode}`, "i"),
  ];
}

function createSeasonPackPatterns(season: number): RegExp[] {
  const seasonPadded = season.toString().padStart(2, "0");

  return [
    new RegExp(`Season\\s*0*${season}\\b|Season\\s*${seasonPadded}\\b`, "i"),
    new RegExp(`S${seasonPadded}\\b`, "i"),
    new RegExp(`S${season}\\b`, "i"),
    new RegExp(`S${seasonPadded}\\s*(Complete|Full|All)`, "i"),
    new RegExp(`S${season}\\s*(Complete|Full|All)`, "i"),
    new RegExp(`All\\s*Episode`, "i"),
    new RegExp(`Complete`, "i"),
  ];
}

function matchesEpisodeRange(
  haystack: string,
  season: number,
  episode: number,
): boolean {
  const seasonVariants = [
    season.toString(),
    season.toString().padStart(2, "0"),
  ];
  const episodeVariants = [
    episode.toString(),
    episode.toString().padStart(2, "0"),
  ];

  return seasonVariants.some((seasonValue) =>
    episodeVariants.some((episodeValue) => {
      const rangePatterns = [
        new RegExp(
          `S${seasonValue}E\\d{1,2}\\s*[-~]\\s*E?${episodeValue}`,
          "i",
        ),
        new RegExp(
          `S${seasonValue}E${episodeValue}\\s*[-~]\\s*E?\\d{1,2}`,
          "i",
        ),
        new RegExp(`S${seasonValue}E\\d{1,2}\\s*[-~]\\s*\\d{1,2}`, "i"),
      ];

      return rangePatterns.some((pattern) => pattern.test(haystack));
    }),
  );
}

function matchesEpisode(
  subtitle: SubSourceSubtitleResult,
  season?: number,
  episode?: number,
): boolean {
  if (!season || !episode) return true;

  const haystack = [
    ...(subtitle.releaseInfo ?? []),
    subtitle.commentary ?? "",
  ].join(" ");

  const exactEpisodeMatch = createEpisodePatterns(season, episode).some(
    (pattern) => pattern.test(haystack),
  );
  if (exactEpisodeMatch) return true;

  const rangeMatch = matchesEpisodeRange(haystack, season, episode);
  if (rangeMatch) return true;

  return createSeasonPackPatterns(season).some((pattern) =>
    pattern.test(haystack),
  );
}

function mapSubSourceCaptions(
  subtitles: SubSourceSubtitleResult[],
  backendUrl: string,
  season?: number,
  episode?: number,
): CaptionListItem[] {
  return subtitles
    .filter((subtitle) => matchesEpisode(subtitle, season, episode))
    .reduce<CaptionListItem[]>((captions, subtitle) => {
      const language = normalizeSubSourceLanguage(subtitle.language);
      if (!language) return captions;

      const releaseName = subtitle.releaseInfo?.join(", ").trim();
      const downloadUrl = `${backendUrl}/api/subtitles/subsource/${subtitle.subtitleId}/download`;

      captions.push({
        id: downloadUrl,
        language,
        url: downloadUrl,
        type: "srt",
        needsProxy: false,
        opensubtitles: true,
        display: releaseName || subtitle.commentary || subtitle.language,
        source: "subsource",
      });

      return captions;
    }, []);
}

async function fetchSubSourceSubtitlePage(
  backendUrl: string,
  movieId: number,
  page: number,
): Promise<SubSourceSubtitleResponse> {
  const subtitlesUrl = new URL(`${backendUrl}/api/subtitles/subsource`);
  subtitlesUrl.searchParams.set("movieId", String(movieId));
  subtitlesUrl.searchParams.set("sort", "rating");
  subtitlesUrl.searchParams.set("limit", String(SUBSOURCE_PAGE_SIZE));
  subtitlesUrl.searchParams.set("page", String(page));

  return ofetch<SubSourceSubtitleResponse>(subtitlesUrl.toString());
}

export async function scrapeSubSourceCaptions(
  backendUrl: string | null,
  tmdbId: string | number,
  title: string,
  releaseYear: number,
  mediaType: "movie" | "show",
  imdbId?: string,
  season?: number,
  episode?: number,
): Promise<CaptionListItem[]> {
  try {
    if (!backendUrl) {
      console.warn("Backend URL is not configured; skipping SubSource search");
      return [];
    }
    const tmdbIdValue =
      typeof tmdbId === "string" ? parseInt(tmdbId, 10) : tmdbId;
    if (!tmdbIdValue || Number.isNaN(tmdbIdValue)) {
      console.warn("No valid TMDB ID available for SubSource subtitle search");
      return [];
    }

    const searchUrl = new URL(`${backendUrl}/api/subtitles/subsource/search`);
    const resolvedImdbId =
      imdbId ?? (await resolveImdbIdFromTmdb(tmdbIdValue, mediaType));

    if (resolvedImdbId) {
      searchUrl.searchParams.set("searchType", "imdb");
      searchUrl.searchParams.set("imdb", resolvedImdbId);
    } else {
      searchUrl.searchParams.set("searchType", "text");
      searchUrl.searchParams.set("q", title);
      searchUrl.searchParams.set("year", String(releaseYear));
    }

    searchUrl.searchParams.set(
      "type",
      mediaType === "show" ? "series" : "movie",
    );
    if (mediaType === "show" && season) {
      searchUrl.searchParams.set("season", String(season));
    }

    const searchData = await ofetch<SubSourceSearchResponse>(
      searchUrl.toString(),
    );
    const matches = searchData.data ?? [];
    if (!searchData.success || matches.length === 0) {
      return [];
    }

    const chosenMatch =
      mediaType === "show" && season
        ? (matches.find((item) => item.season === season) ?? matches[0])
        : matches[0];

    if (!chosenMatch?.movieId) {
      return [];
    }

    const firstPage = await fetchSubSourceSubtitlePage(
      backendUrl,
      chosenMatch.movieId,
      1,
    );
    const firstPageSubtitles = firstPage.data ?? [];
    if (!firstPage.success || firstPageSubtitles.length === 0) {
      return [];
    }

    let matchedSubtitles = mapSubSourceCaptions(
      firstPageSubtitles,
      backendUrl,
      season,
      episode,
    );

    if (
      mediaType === "show" &&
      season &&
      episode &&
      matchedSubtitles.length === 0
    ) {
      const totalPages = Math.min(
        firstPage.pagination?.pages ?? 1,
        SUBSOURCE_MAX_TV_PAGES,
      );

      for (let page = 2; page <= totalPages; page += 1) {
        const pageData = await fetchSubSourceSubtitlePage(
          backendUrl,
          chosenMatch.movieId,
          page,
        );
        const pageSubtitles = pageData.data ?? [];
        if (!pageData.success || pageSubtitles.length === 0) {
          continue;
        }

        matchedSubtitles = mapSubSourceCaptions(
          pageSubtitles,
          backendUrl,
          season,
          episode,
        );
        if (matchedSubtitles.length > 0) {
          break;
        }
      }
    }

    console.log(`Found ${matchedSubtitles.length} SubSource subtitles`);
    return matchedSubtitles;
  } catch (error) {
    console.error("Error fetching SubSource subtitles:", error);
    return [];
  }
}
