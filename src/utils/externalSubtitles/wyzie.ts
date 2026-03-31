import type { SubtitleData } from "wyzie-lib";
import { configure, searchSubtitles } from "wyzie-lib";

import { conf } from "@/setup/config";
import { CaptionListItem } from "@/stores/player/slices/source";

function normalizeSubtitleFormat(
  format: string | undefined,
  url: string | undefined,
): string {
  const normalizedFormat = format?.trim().toLowerCase();
  if (normalizedFormat) return normalizedFormat;

  if (!url) return "srt";

  try {
    const pathname = new URL(url).pathname;
    const extension = pathname.split(".").pop()?.toLowerCase();
    return extension || "srt";
  } catch {
    return "srt";
  }
}

function buildWyzieCaptionId(subtitle: SubtitleData, format: string): string {
  const source = subtitle.source?.toString() || "unknown";
  const language = subtitle.language || "unknown";
  const url = subtitle.url || "";
  return `wyzie:${source}:${subtitle.id}:${language}:${format}:${url}`;
}

export async function scrapeWyzieCaptions(
  tmdbId: string | number,
  imdbId: string,
  season?: number,
  episode?: number,
): Promise<CaptionListItem[]> {
  try {
    const wyzieApiKey = conf().WYZIE_API_KEY;

    configure({
      baseUrl: "https://sub.wyzie.io",
    });

    const baseSearchParams: any = {
      source: "all",
      refresh: true,
    };

    if (wyzieApiKey) {
      baseSearchParams.key = wyzieApiKey;
    }

    if (season && episode) {
      baseSearchParams.season = season;
      baseSearchParams.episode = episode;
    }

    if (!wyzieApiKey) {
      console.warn(
        "Wyzie API key is not configured; skipping authenticated subtitle search",
      );
      return [];
    }

    const searchRequests: Array<Promise<SubtitleData[]>> = [];

    if (imdbId) {
      const imdbSearchParams = {
        ...baseSearchParams,
        imdb_id: imdbId,
      };
      console.info("Searching Wyzie subtitles with IMDb params:", {
        ...imdbSearchParams,
        key: "[redacted]",
      });
      searchRequests.push(searchSubtitles(imdbSearchParams));
    }

    if (tmdbId) {
      const parsedTmdbId =
        typeof tmdbId === "string" ? parseInt(tmdbId, 10) : tmdbId;

      if (!Number.isNaN(parsedTmdbId)) {
        const tmdbSearchParams = {
          ...baseSearchParams,
          tmdb_id: parsedTmdbId,
        };
        console.info("Searching Wyzie subtitles with TMDB params:", {
          ...tmdbSearchParams,
          key: "[redacted]",
        });
        searchRequests.push(searchSubtitles(tmdbSearchParams));
      }
    }

    const wyzieSearchResults = await Promise.allSettled(searchRequests);
    const wyzieSubtitles: SubtitleData[] = wyzieSearchResults.flatMap(
      (result) => {
        if (result.status === "fulfilled") return result.value;

        console.error("A Wyzie subtitle search failed:", result.reason);
        return [];
      },
    );

    const wyzieCaptions: CaptionListItem[] = wyzieSubtitles.map((subtitle) => {
      const type = normalizeSubtitleFormat(subtitle.format, subtitle.url);

      return {
        id: buildWyzieCaptionId(subtitle, type),
        language: subtitle.language || "unknown",
        url: subtitle.url,
        type,
        needsProxy: false,
        opensubtitles: true,
        // Additional metadata from Wyzie
        display: subtitle.display,
        media: subtitle.media,
        isHearingImpaired: subtitle.isHearingImpaired,
        source: `wyzie ${subtitle.source?.toString() === "opensubtitles" ? "opensubs" : subtitle.source}`,
        encoding: subtitle.encoding,
      };
    });

    return wyzieCaptions;
  } catch (error) {
    console.error("Error fetching Wyzie subtitles:", error);
    return [];
  }
}
