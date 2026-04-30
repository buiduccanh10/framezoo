import { useEffect } from "react";

import { mwFetch } from "@/backend/helpers/fetch";
import { usePlayerMeta } from "@/components/player/hooks/usePlayerMeta";
import { conf } from "@/setup/config";
import type { PlayerMeta } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

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

export function normalizeBackendSkipSegments(source: unknown): SegmentData[] {
  if (!Array.isArray(source)) return [];

  const output: SegmentData[] = [];
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const type = (item as Record<string, unknown>).type;
    if (
      type !== "intro" &&
      type !== "recap" &&
      type !== "credits" &&
      type !== "preview"
    ) {
      continue;
    }
    const normalized = normalizeSegment(type, item);
    if (normalized) output.push(normalized);
  }
  return output;
}

export function useSkipTime() {
  const { playerMeta: meta } = usePlayerMeta();
  const cacheKey = getSkipSegmentsCacheKey(meta ?? null);
  const skipSegmentsCacheKey = usePlayerStore((s) => s.skipSegmentsCacheKey);
  const skipSegments = usePlayerStore((s) => s.skipSegments);
  const setSkipSegments = usePlayerStore((s) => s.setSkipSegments);
  const backendUrl = conf().BACKEND_URL;

  useEffect(() => {
    if (!cacheKey) return;
    // Already have segments for this media – don't refetch (e.g. when opening menu)
    if (usePlayerStore.getState().skipSegmentsCacheKey === cacheKey) return;
    // Another fetch for this key is already in progress (e.g. two components mounted)
    if (fetchingForCacheKey === cacheKey) return;
    fetchingForCacheKey = cacheKey;

    const fetchBackendSkipSegments = async (): Promise<{
      segments: SegmentData[];
      source: "introdb" | "theintrodb" | null;
    }> => {
      if (!backendUrl || !meta?.tmdbId) {
        return { source: null, segments: [] };
      }

      const parsedBackendUrl = backendUrl.replace(/\/+$/, "");
      const query = new URLSearchParams({
        type: meta.type,
        tmdbId: meta.tmdbId,
      });
      if (meta.type === "show") {
        if (meta.season?.number)
          query.set("season", String(meta.season.number));
        if (meta.episode?.number)
          query.set("episode", String(meta.episode.number));
      }
      if (meta.imdbId) query.set("imdbId", meta.imdbId);

      const data = await mwFetch<{
        segments?: unknown;
        source?: unknown;
      }>(`${parsedBackendUrl}/api/skip-segments?${query.toString()}`);

      const source =
        data?.source === "introdb" || data?.source === "theintrodb"
          ? data.source
          : null;

      return {
        source,
        segments: normalizeBackendSkipSegments(data?.segments),
      };
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
        const backendResult = await fetchBackendSkipSegments();
        currentSkipTimeSource = backendResult.source;
        applySegments(backendResult.segments);
      } catch (error) {
        console.error("Error fetching backend skip segments:", error);
        currentSkipTimeSource = null;
        applySegments([]);
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
    backendUrl,
  ]);

  // Only return segments when they're for the current media (avoid showing stale data)
  return cacheKey === skipSegmentsCacheKey ? skipSegments : [];
}
