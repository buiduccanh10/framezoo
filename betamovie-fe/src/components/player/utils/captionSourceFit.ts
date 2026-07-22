import { downloadCaptionAsVtt } from "@/backend/helpers/subs";
import type { SegmentData } from "@/components/player/hooks/useSkipTime";
import type { CaptionListItem } from "@/stores/player/slices/source";

import { type CaptionCueType, parseCanonicalVtt } from "./captions";

export type CaptionFitConfidence = "high" | "medium" | "low";

export interface CaptionSourceFitScore {
  score: number;
  confidence: CaptionFitConfidence;
  breakdown: {
    durationFit: number | null;
    introFit: number | null;
    creditsFit: number | null;
  };
}

export interface CaptionSourceFitContext {
  videoDurationMs: number;
  segments: SegmentData[];
}

const SCORE_CACHE_TTL_SECONDS = 30 * 60;
const scoreCache = new Map<
  string,
  { expiry: number; value: CaptionSourceFitScore | null }
>();
const inFlightScores = new Map<string, Promise<CaptionSourceFitScore | null>>();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizePercent(value: number) {
  return Math.round(clamp(value, 0, 100));
}

function makeSegmentFingerprint(segments: SegmentData[]) {
  return segments
    .map(
      (segment) =>
        `${segment.type}:${segment.start_ms ?? "n"}:${segment.end_ms ?? "n"}:${segment.confidence ?? "n"}`,
    )
    .join("|");
}

function getCueMetrics(cues: CaptionCueType[]) {
  if (cues.length === 0) {
    return {
      firstCueStart: 0,
      lastCueEnd: 0,
      totalCueDuration: 0,
    };
  }

  let firstCueStart = Number.POSITIVE_INFINITY;
  let lastCueEnd = 0;
  let totalCueDuration = 0;

  for (const cue of cues) {
    firstCueStart = Math.min(firstCueStart, cue.start);
    lastCueEnd = Math.max(lastCueEnd, cue.end);
    totalCueDuration += Math.max(0, cue.end - cue.start);
  }

  return {
    firstCueStart: Number.isFinite(firstCueStart) ? firstCueStart : 0,
    lastCueEnd,
    totalCueDuration,
  };
}

function getOverlappedDurationMs(
  cues: CaptionCueType[],
  rangeStartMs: number,
  rangeEndMs: number,
) {
  if (rangeEndMs <= rangeStartMs) return 0;

  let overlapMs = 0;
  for (const cue of cues) {
    const overlapStart = Math.max(rangeStartMs, cue.start);
    const overlapEnd = Math.min(rangeEndMs, cue.end);
    if (overlapEnd > overlapStart) {
      overlapMs += overlapEnd - overlapStart;
    }
  }
  return overlapMs;
}

function computeDurationFit(
  cues: CaptionCueType[],
  videoDurationMs: number,
): number | null {
  if (videoDurationMs <= 0 || cues.length === 0) return null;

  const { firstCueStart, lastCueEnd, totalCueDuration } = getCueMetrics(cues);
  const tailToleranceMs = Math.max(45_000, videoDurationMs * 0.12);
  const startToleranceMs = Math.max(10_000, videoDurationMs * 0.03);
  const cueCoverageMs = Math.max(totalCueDuration, 1);

  const tailFit =
    1 - clamp(Math.abs(videoDurationMs - lastCueEnd) / tailToleranceMs, 0, 1);
  const startFit = 1 - clamp(Math.abs(firstCueStart) / startToleranceMs, 0, 1);

  const overflowMs = cues.reduce((total, cue) => {
    const beforeStart = Math.max(0, -cue.start);
    const afterEnd = Math.max(0, cue.end - videoDurationMs);
    return total + beforeStart + afterEnd;
  }, 0);
  const overflowPenalty = clamp(overflowMs / cueCoverageMs, 0, 1);
  const overflowFit = 1 - overflowPenalty;

  return normalizePercent(tailFit * 70 + startFit * 20 + overflowFit * 10);
}

function computeSilenceFitForSegment(
  cues: CaptionCueType[],
  segment: SegmentData | undefined,
  videoDurationMs: number,
): number | null {
  if (!segment) return null;
  const startMs = segment.start_ms ?? 0;
  const endMs = segment.end_ms ?? videoDurationMs;
  if (endMs <= startMs) return null;

  const segmentDurationMs = endMs - startMs;
  const overlapMs = getOverlappedDurationMs(cues, startMs, endMs);
  const speechRatio = clamp(overlapMs / segmentDurationMs, 0, 1);

  return normalizePercent((1 - speechRatio) * 100);
}

export function computeCaptionSourceFitScore(
  cues: CaptionCueType[],
  context: CaptionSourceFitContext,
): CaptionSourceFitScore | null {
  if (cues.length === 0) return null;

  const { videoDurationMs, segments } = context;
  const intro = segments.find((segment) => segment.type === "intro");
  const credits = segments.find((segment) => segment.type === "credits");

  const durationFit = computeDurationFit(cues, videoDurationMs);
  const introFit = computeSilenceFitForSegment(cues, intro, videoDurationMs);
  const creditsFit = computeSilenceFitForSegment(
    cues,
    credits,
    videoDurationMs,
  );

  const weightedParts = [
    durationFit !== null ? { value: durationFit, weight: 0.6 } : null,
    introFit !== null ? { value: introFit, weight: 0.15 } : null,
    creditsFit !== null ? { value: creditsFit, weight: 0.25 } : null,
  ].filter((part): part is { value: number; weight: number } => part !== null);

  if (weightedParts.length === 0) return null;

  const totalWeight = weightedParts.reduce(
    (total, part) => total + part.weight,
    0,
  );
  const score =
    weightedParts.reduce((total, part) => total + part.value * part.weight, 0) /
    totalWeight;

  let confidence: CaptionFitConfidence = "low";
  if (durationFit !== null && (introFit !== null || creditsFit !== null)) {
    confidence = "medium";
  } else if (durationFit !== null) {
    confidence = "low";
  }

  return {
    score: normalizePercent(score),
    confidence,
    breakdown: {
      durationFit,
      introFit,
      creditsFit,
    },
  };
}

export async function scoreCaptionSourceFit(
  caption: CaptionListItem,
  context: CaptionSourceFitContext,
): Promise<CaptionSourceFitScore | null> {
  if (!caption.opensubtitles) {
    return {
      score: 100,
      confidence: "high",
      breakdown: {
        durationFit: null,
        introFit: null,
        creditsFit: null,
      },
    };
  }

  const cacheKey = [
    caption.url,
    context.videoDurationMs,
    makeSegmentFingerprint(context.segments),
  ].join("::");
  const now = Date.now();
  const cached = scoreCache.get(cacheKey);
  if (cached && cached.expiry > now) return cached.value;

  const existing = inFlightScores.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const vttData = await downloadCaptionAsVtt(caption);
      const cues = parseCanonicalVtt(vttData);
      const score = computeCaptionSourceFitScore(cues, context);
      scoreCache.set(cacheKey, {
        value: score,
        expiry: now + SCORE_CACHE_TTL_SECONDS * 1000,
      });
      return score;
    } catch (error) {
      console.warn(
        "Skipping caption source fit for unavailable subtitle:",
        error,
      );
      scoreCache.set(cacheKey, {
        value: null,
        expiry: now + 60 * 1000,
      });
      return null;
    } finally {
      inFlightScores.delete(cacheKey);
    }
  })();

  inFlightScores.set(cacheKey, promise);
  return promise;
}
