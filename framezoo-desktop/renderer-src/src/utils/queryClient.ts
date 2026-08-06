import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { QueryClient } from "@tanstack/react-query";

export const TMDB_METADATA_CACHE_TTL_MS = 60 * 60 * 1000;
export const TMDB_METADATA_CACHE_GC_MS = 24 * 60 * 60 * 1000;
export const TMDB_METADATA_CACHE_KEY = "__MW::tmdbMetadataQueryCache";
export const TMDB_METADATA_CACHE_BUSTER = "tmdb-metadata-v4";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: TMDB_METADATA_CACHE_TTL_MS,
      gcTime: TMDB_METADATA_CACHE_GC_MS,
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(2_000 * 2 ** attemptIndex, 8_000),
      refetchOnWindowFocus: false,
    },
  },
});

export const queryPersister = createSyncStoragePersister({
  key: TMDB_METADATA_CACHE_KEY,
  storage: window.localStorage,
});
