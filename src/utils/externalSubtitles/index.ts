/* eslint-disable no-console */
import { PlayerMeta } from "@/stores/player/slices/source";

import { scrapeFebboxCaptions as _scrapeFebboxCaptions } from "./febbox";
import { scrapeOpenSubtitlesCaptions } from "./opensubtitles";
import { scrapeVdrkCaptions } from "./vdrk";
import { scrapeWyzieCaptions } from "./wyzie";

export async function scrapeExternalSubtitles(
  meta: PlayerMeta,
): Promise<import("@/stores/player/slices/source").CaptionListItem[]> {
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
    const allCaptions: import("@/stores/player/slices/source").CaptionListItem[] =
      [];
    let completedSources = 0;
    const sourcePromises: Array<
      Promise<import("@/stores/player/slices/source").CaptionListItem[]>
    > = [];

    // Helper function to handle individual source completion
    const handleSourceCompletion = (
      sourceName: string,
      captions: import("@/stores/player/slices/source").CaptionListItem[],
    ) => {
      allCaptions.push(...captions);
      completedSources += 1;
      console.log(
        `${sourceName} completed with ${captions.length} captions (${completedSources}/${totalSources} sources done)`,
      );
    };

    const withSourceTimeout = (
      sourceName: string,
      promise: Promise<
        import("@/stores/player/slices/source").CaptionListItem[]
      >,
    ) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      return Promise.race([
        promise,
        new Promise<import("@/stores/player/slices/source").CaptionListItem[]>(
          (resolve) => {
            timeoutId = setTimeout(() => {
              console.warn(
                `${sourceName} timed out after ${timeoutMs}ms, using empty subtitle list`,
              );
              resolve([]);
            }, timeoutMs);
          },
        ),
      ]).then((captions) => {
        if (timeoutId) clearTimeout(timeoutId);
        handleSourceCompletion(sourceName, captions);
        return captions;
      });
    };

    if (tmdbId && imdbId) {
      const wyziePromise = scrapeWyzieCaptions(tmdbId, imdbId, season, episode);
      sourcePromises.push(withSourceTimeout("Wyzie", wyziePromise));
    }

    if (imdbId) {
      const openSubsPromise = scrapeOpenSubtitlesCaptions(
        imdbId,
        season,
        episode,
      );
      sourcePromises.push(withSourceTimeout("OpenSubtitles", openSubsPromise));
    }

    if (tmdbId) {
      const vdrkPromise = scrapeVdrkCaptions(tmdbId, season, episode);
      sourcePromises.push(withSourceTimeout("Granite", vdrkPromise));
    }

    const totalSources = sourcePromises.length;

    // Start all sources concurrently and handle them as they complete
    await Promise.allSettled(sourcePromises);

    console.log(
      `Found ${allCaptions.length} total external captions from all sources`,
    );

    return allCaptions;
  } catch (error) {
    console.error("Error in scrapeExternalSubtitles:", error);
    return [];
  }
}

// Re-export individual functions for direct access if needed
export { scrapeWyzieCaptions } from "./wyzie";
export { scrapeOpenSubtitlesCaptions } from "./opensubtitles";
export { scrapeFebboxCaptions } from "./febbox";
export { scrapeVdrkCaptions } from "./vdrk";
