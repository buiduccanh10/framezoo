/* eslint-disable no-console */
import { labelToLanguageCode } from "@p-stream/providers";

import { get as getTmdb } from "@/backend/metadata/tmdb";
import { conf } from "@/setup/config";
import { CaptionListItem } from "@/stores/player/slices/source";

const SUBSOURCE_API_URL = "https://api.subsource.net";

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
}

function normalizeSubSourceLanguage(language: string): string {
  const normalized = language
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return labelToLanguageCode(normalized) || labelToLanguageCode(language) || "";
}

function createApiHeaders(apiKey: string): HeadersInit {
  return {
    "X-API-Key": apiKey,
  };
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

  return createEpisodePatterns(season, episode).some((pattern) =>
    pattern.test(haystack),
  );
}

export async function scrapeSubSourceCaptions(
  tmdbId: string | number,
  title: string,
  releaseYear: number,
  mediaType: "movie" | "show",
  imdbId?: string,
  season?: number,
  episode?: number,
): Promise<CaptionListItem[]> {
  try {
    const apiKey = conf().SUBSOURCE_API_KEY;
    if (!apiKey) {
      console.warn(
        "SubSource API key is not configured; skipping SubSource subtitle search",
      );
      return [];
    }

    const tmdbIdValue =
      typeof tmdbId === "string" ? parseInt(tmdbId, 10) : tmdbId;
    if (!tmdbIdValue || Number.isNaN(tmdbIdValue)) {
      console.warn("No valid TMDB ID available for SubSource subtitle search");
      return [];
    }

    const searchUrl = new URL(`${SUBSOURCE_API_URL}/api/v1/movies/search`);
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

    const searchResponse = await fetch(searchUrl.toString(), {
      headers: createApiHeaders(apiKey),
    });

    if (!searchResponse.ok) {
      throw new Error(`SubSource search API returned ${searchResponse.status}`);
    }

    const searchData = (await searchResponse.json()) as SubSourceSearchResponse;
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

    const subtitlesUrl = new URL(`${SUBSOURCE_API_URL}/api/v1/subtitles`);
    subtitlesUrl.searchParams.set("movieId", String(chosenMatch.movieId));
    subtitlesUrl.searchParams.set("sort", "rating");

    const subtitleResponse = await fetch(subtitlesUrl.toString(), {
      headers: createApiHeaders(apiKey),
    });

    if (!subtitleResponse.ok) {
      throw new Error(
        `SubSource subtitles API returned ${subtitleResponse.status}`,
      );
    }

    const subtitleData =
      (await subtitleResponse.json()) as SubSourceSubtitleResponse;
    const subtitles = subtitleData.data ?? [];
    if (!subtitleData.success || subtitles.length === 0) {
      return [];
    }

    const subSourceCaptions = subtitles
      .filter((subtitle) => matchesEpisode(subtitle, season, episode))
      .reduce<CaptionListItem[]>((captions, subtitle) => {
        const language = normalizeSubSourceLanguage(subtitle.language);
        if (!language) return captions;

        const releaseName = subtitle.releaseInfo?.join(", ").trim();
        const downloadUrl = `${SUBSOURCE_API_URL}/api/v1/subtitles/${subtitle.subtitleId}/download`;

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

    console.log(`Found ${subSourceCaptions.length} SubSource subtitles`);
    return subSourceCaptions;
  } catch (error) {
    console.error("Error fetching SubSource subtitles:", error);
    return [];
  }
}
