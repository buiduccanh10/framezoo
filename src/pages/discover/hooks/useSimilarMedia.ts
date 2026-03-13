import { useCallback, useEffect, useState } from "react";

import { getRelatedMedia } from "@/backend/metadata/tmdb";
import { TMDBContentTypes } from "@/backend/metadata/types/tmdb";
import type {
  TMDBMovieSearchResult,
  TMDBShowSearchResult,
} from "@/backend/metadata/types/tmdb";

export function useSimilarMedia({
  mediaId,
  mediaType,
  limit = 12,
  enabled = true,
}: {
  mediaId: string;
  mediaType: TMDBContentTypes;
  limit?: number;
  enabled?: boolean;
}) {
  const [media, setMedia] = useState<
    TMDBMovieSearchResult[] | TMDBShowSearchResult[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTVShow = mediaType === TMDBContentTypes.TV;
  const type = isTVShow ? TMDBContentTypes.TV : TMDBContentTypes.MOVIE;

  const fetch = useCallback(async () => {
    if (!mediaId || !enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const tmdbResults = await getRelatedMedia(mediaId, type, limit);
      setMedia(tmdbResults);
    } catch (err) {
      console.error("Failed to load similar media:", err);

      setError((err as Error).message);
      setMedia([]);
    } finally {
      setIsLoading(false);
    }
  }, [mediaId, type, isTVShow, limit, enabled]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return {
    media,
    isLoading,
    error,
    refetch: fetch,
  };
}
