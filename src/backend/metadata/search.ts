import { SimpleCache } from "@/utils/cache";
import { compareByRatingAndVoteDesc } from "@/utils/compareByRatingDesc";
import { MediaItem } from "@/utils/mediaTypes";

import {
  formatTMDBMetaToMediaItem,
  formatTMDBSearchResult,
  getMediaDetails,
  getMediaPoster,
  multiSearch,
} from "./tmdb";
import { TMDBContentTypes } from "./types/tmdb";

export interface MWQuery {
  searchQuery: string;
}

const cache = new SimpleCache<MWQuery, MediaItem[]>();
cache.setCompare((a, b) => {
  return a.searchQuery.trim() === b.searchQuery.trim();
});
cache.initialize();

// detect "tmdb:123456" or "tmdb:123456:movie" or "tmdb:123456:tv"
const tmdbIdPattern = /^tmdb:(\d+)(?::(movie|tv))?$/i;

export async function searchForMedia(query: MWQuery): Promise<MediaItem[]> {
  if (cache.has(query)) return cache.get(query) as MediaItem[];
  const { searchQuery } = query;

  // Check if query is a TMDB ID
  const tmdbMatch = searchQuery.match(tmdbIdPattern);
  if (tmdbMatch) {
    const id = tmdbMatch[1];
    const type =
      tmdbMatch[2]?.toLowerCase() === "tv"
        ? TMDBContentTypes.TV
        : TMDBContentTypes.MOVIE;

    try {
      const details = await getMediaDetails(id, type);
      if (details) {
        const genreIds = Array.isArray((details as any).genres)
          ? (details as any).genres
              .map((genre: { id?: number }) => genre.id)
              .filter((genreId: unknown): genreId is number =>
                Number.isFinite(genreId),
              )
          : undefined;

        // Format the media details to our common format
        const mediaResult =
          type === TMDBContentTypes.MOVIE
            ? {
                id: details.id,
                title: (details as any).title,
                poster: getMediaPoster((details as any).poster_path),
                object_type: type,
                original_release_date: new Date((details as any).release_date),
              }
            : {
                id: details.id,
                title: (details as any).name,
                poster: getMediaPoster((details as any).poster_path),
                object_type: type,
                original_release_date: new Date(
                  (details as any).first_air_date,
                ),
              };

        const mediaItem = formatTMDBMetaToMediaItem(mediaResult);
        const result = [{ ...mediaItem, genreIds }];
        cache.set(query, result, 3600);
        return result;
      }
    } catch (error) {
      console.error("Error fetching by TMDB ID:", error);
    }
  }

  const data = await multiSearch(searchQuery);

  const rankedResults = [...data].sort(compareByRatingAndVoteDesc);
  const results = rankedResults.map((v) => {
    const formattedResult = formatTMDBSearchResult(v, v.media_type);
    const mediaItem = formatTMDBMetaToMediaItem(formattedResult);
    return {
      ...mediaItem,
      genreIds: v.genre_ids,
    };
  });

  // cache results for 1 hour
  cache.set(query, results, 3600);
  return results;
}
