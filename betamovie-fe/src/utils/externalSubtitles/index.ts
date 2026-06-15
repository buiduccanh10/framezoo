/* eslint-disable no-console */
import { PlayerMeta } from "@/stores/player/slices/source";
import type { CaptionListItem } from "@/stores/player/slices/source";

import { scrapeOpenSubtitlesCaptions } from "./opensubtitles";
import { scrapeSubsourceCaptions } from "./subsource";
import { scrapeVdrkCaptions } from "./vdrk";
import { scrapeWyzieCaptions } from "./wyzie";

const EXTERNAL_SUBTITLE_SOURCE_PRIORITY: Record<string, number> = {
  wyzie: 0,
  opensubs: 1,
  subsource: 2,
  granite: 3,
};

function getExternalSubtitleSourcePriority(caption: CaptionListItem) {
  const normalizedSource = caption.source?.toLowerCase() ?? "";
  if (normalizedSource.includes("wyzie")) {
    return EXTERNAL_SUBTITLE_SOURCE_PRIORITY.wyzie;
  }
  if (normalizedSource.includes("opensubs")) {
    return EXTERNAL_SUBTITLE_SOURCE_PRIORITY.opensubs;
  }
  if (normalizedSource.includes("subsource")) {
    return EXTERNAL_SUBTITLE_SOURCE_PRIORITY.subsource;
  }
  if (normalizedSource.includes("granite")) {
    return EXTERNAL_SUBTITLE_SOURCE_PRIORITY.granite;
  }
  return Number.MAX_SAFE_INTEGER;
}

function sortExternalCaptions(captions: CaptionListItem[]) {
  return [...captions].sort((a, b) => {
    const priorityDiff =
      getExternalSubtitleSourcePriority(a) -
      getExternalSubtitleSourcePriority(b);
    if (priorityDiff !== 0) return priorityDiff;

    const sourceCompare = (a.source ?? "").localeCompare(b.source ?? "");
    if (sourceCompare !== 0) return sourceCompare;

    const languageCompare = a.language.localeCompare(b.language);
    if (languageCompare !== 0) return languageCompare;

    return (a.display ?? "").localeCompare(b.display ?? "");
  });
}

export interface ExternalSubtitleProgressUpdate {
  captions: CaptionListItem[];
  completed: number;
  total: number;
  sourceName: string;
}

export async function scrapeExternalSubtitles(
  meta: PlayerMeta,
  onProgress?: (update: ExternalSubtitleProgressUpdate) => void,
): Promise<CaptionListItem[]> {
  try {
    const imdbId = meta.imdbId;
    const tmdbId = meta.tmdbId;
    if (!imdbId && !tmdbId) {
      console.log(
        "No IMDb ID or TMDB ID available for external subtitle scraping",
      );
      return [];
    }

    const season = meta.season?.number;
    const episode = meta.episode?.number;

    // External subtitle providers can be noticeably slower on Safari.
    // Keep a timeout so a hung provider does not block forever, but give
    // the slower sources enough time to return real results.
    const timeoutMs = 30000;

    // Start all promises and collect results as they complete
    const allCaptions: CaptionListItem[] = [];
    let completedSources = 0;
    const sourcePromises: Array<Promise<CaptionListItem[]>> = [];
    const sourceDefinitions: Array<{
      name: string;
      priority: number;
      promise: Promise<CaptionListItem[]>;
    }> = [];

    // Helper function to handle individual source completion
    const handleSourceCompletion = (
      sourceName: string,
      captions: CaptionListItem[],
    ) => {
      completedSources += 1;
      const sortedCaptions = sortExternalCaptions(captions);
      allCaptions.push(...sortedCaptions);
      console.log(
        `${sourceName} completed with ${captions.length} captions (${completedSources}/${totalSources} sources done)`,
      );
      onProgress?.({
        sourceName,
        captions: sortedCaptions,
        completed: completedSources,
        total: totalSources,
      });
    };

    const withSourceTimeout = (
      sourceName: string,
      promise: Promise<CaptionListItem[]>,
    ) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      return Promise.race([
        promise,
        new Promise<CaptionListItem[]>((resolve) => {
          timeoutId = setTimeout(() => {
            console.warn(
              `${sourceName} timed out after ${timeoutMs}ms, using empty subtitle list`,
            );
            resolve([]);
          }, timeoutMs);
        }),
      ]).then((captions) => {
        if (timeoutId) clearTimeout(timeoutId);
        handleSourceCompletion(sourceName, captions);
        return captions;
      });
    };

    if (tmdbId && imdbId) {
      sourceDefinitions.push({
        name: "Wyzie",
        priority: 0,
        promise: scrapeWyzieCaptions(tmdbId, imdbId, season, episode),
      });
    }

    if (imdbId) {
      sourceDefinitions.push({
        name: "OpenSubtitles",
        priority: 1,
        promise: scrapeOpenSubtitlesCaptions(imdbId, season, episode),
      });
    }

    if (imdbId || meta.title) {
      sourceDefinitions.push({
        name: "SubSource",
        priority: 2,
        promise: scrapeSubsourceCaptions(
          {
            imdbId,
            title: meta.title,
            releaseYear: meta.releaseYear,
            season,
          },
          season,
          episode,
        ),
      });
    }

    if (tmdbId) {
      sourceDefinitions.push({
        name: "Granite",
        priority: 3,
        promise: scrapeVdrkCaptions(tmdbId, season, episode),
      });
    }

    sourceDefinitions.sort((a, b) => a.priority - b.priority);
    sourcePromises.push(
      ...sourceDefinitions.map((source) =>
        withSourceTimeout(source.name, source.promise),
      ),
    );

    const totalSources = sourcePromises.length;
    if (totalSources === 0) {
      onProgress?.({
        sourceName: "",
        captions: [],
        completed: 0,
        total: 0,
      });
      return [];
    }

    // Start all sources concurrently and handle them as they complete
    await Promise.allSettled(sourcePromises);

    console.log(
      `Found ${allCaptions.length} total external captions from all sources`,
    );

    return sortExternalCaptions(allCaptions);
  } catch (error) {
    console.error("Error in scrapeExternalSubtitles:", error);
    return [];
  }
}

// Re-export individual functions for direct access if needed
export { scrapeWyzieCaptions } from "./wyzie";
export { scrapeOpenSubtitlesCaptions } from "./opensubtitles";
export { scrapeSubsourceCaptions } from "./subsource";
export { scrapeVdrkCaptions } from "./vdrk";
