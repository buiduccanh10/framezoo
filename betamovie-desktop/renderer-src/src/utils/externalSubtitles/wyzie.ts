import { iso6393To1 } from "iso-639-3";
import type { SubtitleData } from "wyzie-lib";
import { configure, searchSubtitles } from "wyzie-lib";

import { conf } from "@/setup/config";
import { useLanguageStore } from "@/stores/language";
import { CaptionListItem } from "@/stores/player/slices/source";
import { useSubtitleStore } from "@/stores/subtitles";

function normalizeSubtitleFormat(
  format: string | undefined | null,
  url: string | undefined,
): string | undefined {
  const normalizedFormat = format?.trim().toLowerCase();
  if (normalizedFormat) return normalizedFormat;

  if (!url) return undefined;

  try {
    const pathname = new URL(url).pathname;
    const extension = pathname.split(".").pop()?.toLowerCase();
    return extension || undefined;
  } catch {
    return undefined;
  }
}

function buildWyzieCaptionId(subtitle: SubtitleData, format?: string): string {
  const source = subtitle.source?.toString() || "unknown";
  const language = subtitle.language || "unknown";
  const url = subtitle.url || "";
  return `wyzie:${source}:${subtitle.id}:${language}:${format ?? "unknown"}:${url}`;
}

function getWyzieCaptionIdentityKey(caption: CaptionListItem): string {
  return [
    caption.url,
    caption.language,
    caption.type ?? "",
    caption.encoding ?? "",
    caption.isHearingImpaired ? "hi" : "normal",
  ].join("::");
}

export async function scrapeWyzieCaptions(
  tmdbId: string | number,
  imdbId: string,
  season?: number,
  episode?: number,
): Promise<CaptionListItem[]> {
  try {
    const wyzieApiKey = conf().WYZIE_API_KEY;
    const lastSelectedLanguage =
      useSubtitleStore.getState().lastSelectedLanguage;
    const appLanguage = useLanguageStore.getState().language;

    function getNormalized(lang: string | null | undefined) {
      let normalized = lang?.trim().toLowerCase().split("-")[0];
      if (normalized && normalized.length === 3) {
        normalized =
          iso6393To1[normalized as keyof typeof iso6393To1] || normalized;
      }
      return normalized;
    }

    const normalizedLastSelected = getNormalized(lastSelectedLanguage);
    const normalizedApp = getNormalized(appLanguage);

    const languagesToSearch = new Set<string>();
    if (normalizedLastSelected) languagesToSearch.add(normalizedLastSelected);
    if (normalizedApp) languagesToSearch.add(normalizedApp);

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

    function addSearchRequests(
      params: { imdb_id?: string; tmdb_id?: number },
      label: string,
    ) {
      languagesToSearch.forEach((lang) => {
        const filteredSearchParams = {
          ...baseSearchParams,
          ...params,
          language: lang,
          encoding: "utf-8",
        };
        console.info(
          `Searching Wyzie subtitles with ${label} params for ${lang}:`,
          {
            ...filteredSearchParams,
            key: "[redacted]",
          },
        );
        searchRequests.push(searchSubtitles(filteredSearchParams));

        const fallbackSearchParams = {
          ...baseSearchParams,
          ...params,
          language: lang,
        };
        console.info(
          `Searching Wyzie subtitles with ${label} fallback params for ${lang}:`,
          {
            ...fallbackSearchParams,
            key: "[redacted]",
          },
        );
        searchRequests.push(searchSubtitles(fallbackSearchParams));
      });

      const rawSearchParams = {
        ...baseSearchParams,
        ...params,
      };
      console.info(`Searching Wyzie subtitles with ${label} raw params:`, {
        ...rawSearchParams,
        key: "[redacted]",
      });
      searchRequests.push(searchSubtitles(rawSearchParams));
    }

    if (imdbId) {
      addSearchRequests({ imdb_id: imdbId }, "IMDb");
    }

    if (tmdbId) {
      const parsedTmdbId =
        typeof tmdbId === "string" ? parseInt(tmdbId, 10) : tmdbId;

      if (!Number.isNaN(parsedTmdbId)) {
        addSearchRequests({ tmdb_id: parsedTmdbId }, "TMDB");
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

    const wyzieCaptions: CaptionListItem[] = [];
    const seenCaptionKeys = new Set<string>();

    wyzieSubtitles.forEach((subtitle) => {
      const type = normalizeSubtitleFormat(subtitle.format, subtitle.url);
      const caption: CaptionListItem = {
        id: buildWyzieCaptionId(subtitle, type),
        language: subtitle.language || "unknown",
        url: subtitle.url,
        type,
        needsProxy: false,
        opensubtitles: true,
        display: subtitle.display,
        media: subtitle.media,
        isHearingImpaired: subtitle.isHearingImpaired,
        source: `wyzie ${subtitle.source?.toString() === "opensubtitles" ? "opensubs" : subtitle.source}`,
        encoding: subtitle.encoding,
      };

      const captionKey = getWyzieCaptionIdentityKey(caption);
      if (seenCaptionKeys.has(captionKey)) return;

      seenCaptionKeys.add(captionKey);
      wyzieCaptions.push(caption);
    });

    return wyzieCaptions;
  } catch (error) {
    console.error("Error fetching Wyzie subtitles:", error);
    return [];
  }
}
