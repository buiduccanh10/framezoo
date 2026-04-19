import { useEffect } from "react";

// import { proxiedFetch } from "@/backend/helpers/fetch";
import { mwFetch, proxiedFetch } from "@/backend/helpers/fetch";
import { usePlayerMeta } from "@/components/player/hooks/usePlayerMeta";
import { conf } from "@/setup/config";
import type { PlayerMeta } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";

// Thanks Nemo for this API
const THE_INTRO_DB_BASE_URL = "https://api.theintrodb.org/v2";
const INTRODB_BASE_URL = "https://api.introdb.app/intro";

// Track the source of the current skip time (for analytics filtering)
let currentSkipTimeSource: "introdb" | "theintrodb" | null = null;

// Prevent multiple components from triggering overlapping fetches for the same media
let fetchingForCacheKey: string | null = null;

/** Cache key for skip segments – matches TIDB API (tmdbId + season + episode number). */
function getSkipSegmentsCacheKey(meta: PlayerMeta | null): string | null {
  if (!meta?.tmdbId) return null;
  if (meta.type === "movie") return `skip-${meta.type}-${meta.tmdbId}`;
  if (meta.type === "show" && meta.season != null && meta.episode != null) {
    return `skip-${meta.type}-${meta.tmdbId}-${meta.season.number}-${meta.episode.number}`;
  }
  return null;
}

export function useSkipTimeSource(): typeof currentSkipTimeSource {
  return currentSkipTimeSource;
}

export interface SegmentData {
  type: "intro" | "recap" | "credits" | "preview";
  start_ms: number | null;
  end_ms: number | null;
  confidence: number | null;
  submission_count: number;
}

export interface SegmentBoundsSeconds {
  start: number;
  end: number | null;
}

/**
 * Converts segment timestamps from milliseconds to seconds and clamps them
 * against the current media duration when available.
 */
export function getSegmentBoundsSeconds(
  segment: SegmentData,
  durationSeconds?: number,
): SegmentBoundsSeconds | null {
  const hasDuration =
    typeof durationSeconds === "number" &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0;
  const maxDuration = hasDuration ? durationSeconds : null;

  const rawStart = Math.max(0, (segment.start_ms ?? 0) / 1000);
  const rawEnd =
    segment.end_ms !== null ? Math.max(0, segment.end_ms / 1000) : null;

  const start =
    maxDuration !== null ? Math.min(rawStart, maxDuration) : rawStart;
  const end =
    rawEnd !== null && maxDuration !== null
      ? Math.min(rawEnd, maxDuration)
      : rawEnd;

  if (maxDuration !== null && start >= maxDuration) return null;
  if (end !== null && end <= start) return null;

  return { start, end };
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeSegment(
  type: SegmentData["type"],
  raw: unknown,
): SegmentData | null {
  if (!raw || typeof raw !== "object") return null;
  const segment = raw as Record<string, unknown>;

  const startMs = toNullableNumber(segment.start_ms);
  const endMs = toNullableNumber(segment.end_ms);

  if (startMs === null && endMs === null) return null;

  const confidence = toNullableNumber(segment.confidence);
  const submissionCount = toNullableNumber(segment.submission_count);

  return {
    type,
    start_ms: startMs,
    end_ms: endMs,
    confidence,
    submission_count:
      submissionCount !== null && submissionCount > 0 ? submissionCount : 1,
  };
}

function pushNormalizedSegments(
  target: SegmentData[],
  type: SegmentData["type"],
  source: unknown,
) {
  if (Array.isArray(source)) {
    for (const item of source) {
      const normalized = normalizeSegment(type, item);
      if (normalized) target.push(normalized);
    }
    return;
  }

  const normalized = normalizeSegment(type, source);
  if (normalized) target.push(normalized);
}

export function useSkipTime() {
  const { playerMeta: meta } = usePlayerMeta();
  const cacheKey = getSkipSegmentsCacheKey(meta ?? null);
  const skipSegmentsCacheKey = usePlayerStore((s) => s.skipSegmentsCacheKey);
  const skipSegments = usePlayerStore((s) => s.skipSegments);
  const setSkipSegments = usePlayerStore((s) => s.setSkipSegments);
  const tidbKeyFromStore = usePreferencesStore((s) => s.tidbKey);
  const tidbKey = conf().TIDB_API_KEY ?? tidbKeyFromStore;

  useEffect(() => {
    if (!cacheKey) return;
    // Already have segments for this media – don't refetch (e.g. when opening menu)
    if (usePlayerStore.getState().skipSegmentsCacheKey === cacheKey) return;
    // Another fetch for this key is already in progress (e.g. two components mounted)
    if (fetchingForCacheKey === cacheKey) return;
    fetchingForCacheKey = cacheKey;

    const fetchTheIntroDBSegments = async (): Promise<{
      segments: SegmentData[];
      tidbNotFound: boolean;
    }> => {
      if (!meta?.tmdbId) return { segments: [], tidbNotFound: false };

      try {
        let apiUrl = `${THE_INTRO_DB_BASE_URL}/media?tmdb_id=${meta.tmdbId}`;
        if (
          meta.type !== "movie" &&
          meta.season?.number &&
          meta.episode?.number
        ) {
          apiUrl += `&season=${meta.season.number}&episode=${meta.episode.number}`;
        }

        const data = await mwFetch(apiUrl, {
          headers: {
            Authorization: tidbKey ? `Bearer ${tidbKey}` : undefined,
          } as HeadersInit,
        });

        const fetchedSegments: SegmentData[] = [];

        // Accept both array/object segment payloads and default missing metadata.
        pushNormalizedSegments(fetchedSegments, "intro", data?.intro);
        pushNormalizedSegments(fetchedSegments, "recap", data?.recap);
        pushNormalizedSegments(fetchedSegments, "credits", data?.credits);
        pushNormalizedSegments(fetchedSegments, "preview", data?.preview);

        // TIDB returned 200 – we have segment data for this media (even if no intro)
        return { segments: fetchedSegments, tidbNotFound: false };
      } catch (error: unknown) {
        const err = error as {
          response?: { status?: number };
          status?: number;
        };
        const status = err?.response?.status ?? err?.status;
        if (status === 404) {
          return { segments: [], tidbNotFound: true };
        }
        console.error("Error fetching TIDB segments:", error);
        return { segments: [], tidbNotFound: false };
      }
    };

    const fetchIntroDBTime = async (): Promise<number | null> => {
      if (!meta?.imdbId || meta.type === "movie") return null;

      try {
        const apiUrl = `${INTRODB_BASE_URL}?imdb_id=${meta.imdbId}&season=${meta.season?.number}&episode=${meta.episode?.number}`;

        const data = await proxiedFetch(apiUrl);

        if (data && typeof data.end_ms === "number") {
          // Convert milliseconds to seconds
          return Math.floor(data.end_ms / 1000);
        }

        return null;
      } catch (error) {
        console.error("Error fetching IntroDB time:", error);
        return null;
      }
    };

    const applySegments = (segmentsToApply: SegmentData[]) => {
      // Only update store if this fetch is still for the current media (avoid stale overwrite)
      const currentKey = getSkipSegmentsCacheKey(
        usePlayerStore.getState().meta ?? null,
      );
      if (currentKey === cacheKey) {
        setSkipSegments(cacheKey, segmentsToApply);
      }
    };

    const fetchSkipTime = async (): Promise<void> => {
      currentSkipTimeSource = null;

      try {
        // Try TheIntroDB API first (supports both movies and TV shows with full segment data)
        const { segments: tidbSegments, tidbNotFound } =
          await fetchTheIntroDBSegments();

        // TIDB returned 200 – use its segments, and backfill missing intro from IntroDB when possible.
        if (!tidbNotFound) {
          let finalSegments = tidbSegments;
          const hasIntro = tidbSegments.some(
            (segment) => segment.type === "intro",
          );

          if (!hasIntro && meta?.type !== "movie") {
            const introDBTime = await fetchIntroDBTime();
            if (introDBTime !== null) {
              currentSkipTimeSource = "introdb";
              finalSegments = [
                {
                  type: "intro",
                  start_ms: 0,
                  end_ms: introDBTime * 1000,
                  confidence: null,
                  submission_count: 1,
                },
                ...tidbSegments,
              ];
            } else {
              currentSkipTimeSource = "theintrodb";
            }
          } else {
            currentSkipTimeSource = "theintrodb";
          }

          applySegments(finalSegments);
          return;
        }

        // TIDB returned 404 – no segment data for this media; try fallback for intro only
        const nonIntroSegments: SegmentData[] = [];
        let fallbackIntroSegment: SegmentData | null = null;

        // Fallback: IntroDB API (TV shows only)
        if (!fallbackIntroSegment && meta?.type !== "movie") {
          const introDBTime = await fetchIntroDBTime();
          if (introDBTime !== null) {
            currentSkipTimeSource = "introdb";
            fallbackIntroSegment = {
              type: "intro",
              start_ms: 0,
              end_ms: introDBTime * 1000,
              confidence: null,
              submission_count: 1,
            };
          }
        }

        const finalSegments: SegmentData[] = [];
        if (fallbackIntroSegment) {
          finalSegments.push(fallbackIntroSegment);
        }
        finalSegments.push(...nonIntroSegments);

        applySegments(finalSegments);
      } finally {
        if (fetchingForCacheKey === cacheKey) {
          fetchingForCacheKey = null;
        }
      }
    };

    fetchSkipTime();
  }, [
    cacheKey,
    meta?.tmdbId,
    meta?.imdbId,
    meta?.title,
    meta?.type,
    meta?.season?.number,
    meta?.episode?.number,
    setSkipSegments,
    tidbKey,
  ]);

  // Only return segments when they're for the current media (avoid showing stale data)
  return cacheKey === skipSegmentsCacheKey ? skipSegments : [];
}
