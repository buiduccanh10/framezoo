/* eslint-disable no-console */
import { conf } from "@/setup/config";
import { useAuthStore } from "@/stores/auth";
import { PlayerMeta } from "@/stores/player/slices/source";

import { scrapeFebboxCaptions as _scrapeFebboxCaptions } from "./febbox";
import { scrapeOpenSubtitlesCaptions } from "./opensubtitles";
import { scrapeSubSourceCaptions } from "./subsource";
import { scrapeVdrkCaptions } from "./vdrk";
import { scrapeWyzieCaptions } from "./wyzie";

export async function scrapeExternalSubtitles(
  meta: PlayerMeta,
): Promise<import("@/stores/player/slices/source").CaptionListItem[]> {
  try {
    const authBackendUrl = useAuthStore.getState().backendUrl;
    const config = conf();
    const backendUrl =
      authBackendUrl ??
      config.BACKEND_URL ??
      (config.BACKEND_URLS.length > 0 ? config.BACKEND_URLS[0] : null);

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

    // Set a reasonable timeout for each source (10 seconds)
    const timeout = 10000;

    // Create timeout promises
    const timeoutPromise = new Promise<
      import("@/stores/player/slices/source").CaptionListItem[]
    >((resolve) => {
      setTimeout(() => resolve([]), timeout);
    });

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

    if (tmdbId && imdbId) {
      const wyziePromise = scrapeWyzieCaptions(tmdbId, imdbId, season, episode);
      sourcePromises.push(
        Promise.race([wyziePromise, timeoutPromise]).then((captions) => {
          handleSourceCompletion("Wyzie", captions);
          return captions;
        }),
      );
    }

    if (imdbId) {
      const openSubsPromise = scrapeOpenSubtitlesCaptions(
        imdbId,
        season,
        episode,
      );
      sourcePromises.push(
        Promise.race([openSubsPromise, timeoutPromise]).then((captions) => {
          handleSourceCompletion("OpenSubtitles", captions);
          return captions;
        }),
      );
    }

    if (tmdbId) {
      const vdrkPromise = scrapeVdrkCaptions(tmdbId, season, episode);
      sourcePromises.push(
        Promise.race([vdrkPromise, timeoutPromise]).then((captions) => {
          handleSourceCompletion("Granite", captions);
          return captions;
        }),
      );

      const subSourcePromise = scrapeSubSourceCaptions(
        backendUrl,
        tmdbId,
        meta.title,
        meta.releaseYear,
        meta.type,
        imdbId,
        season,
        episode,
      );
      sourcePromises.push(
        Promise.race([subSourcePromise, timeoutPromise]).then((captions) => {
          handleSourceCompletion("SubSource", captions);
          return captions;
        }),
      );
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
export { scrapeSubSourceCaptions } from "./subsource";
