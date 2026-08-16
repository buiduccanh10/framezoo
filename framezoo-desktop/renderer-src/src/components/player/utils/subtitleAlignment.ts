import { mwFetch } from "@/backend/helpers/fetch";
import { conf } from "@/setup/config";

import { extractAudioWindow } from "./audioCapture";
import {
  SubtitleTimingSegment,
  removeVttAds,
  shiftVttPiecewiseTimestamps,
  shiftVttTimestamps,
} from "./captions";

export const SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS = 60;
export const SUBTITLE_ALIGNMENT_MIN_CONFIDENCE = 60;
export const SUBTITLE_ALIGNMENT_MIN_CONSENSUS_WINDOWS = 2;
export const SUBTITLE_ALIGNMENT_OFFSET_TOLERANCE_MS = 1_200;
export const SUBTITLE_ALIGNMENT_MIN_SCORE_MARGIN = 10;
export const SUBTITLE_ALIGNMENT_MAX_PLAUSIBLE_OFFSET_MS = 180_000;
export const SUBTITLE_ALIGNMENT_MAX_WINDOWS = 6;
export const SUBTITLE_ALIGNMENT_INITIAL_WINDOWS = 2;

const SUBTITLE_ALIGNMENT_WINDOW_FALLBACK_OFFSETS_SECONDS = [
  -120, 120, -240, 240,
];
export const SUBTITLE_ALIGNMENT_TIMELINE_ANCHOR_FRACTIONS = [
  0.15, 0.35, 0.55, 0.75,
];
const SUBTITLE_ALIGNMENT_MIN_AUDIO_WINDOW_SECONDS = 1;

export interface SubtitleAlignmentResponse {
  aligned: boolean;
  offsetMs: number;
  confidence: number;
  speechIntervals: Array<{
    startMs: number;
    endMs: number;
  }>;
  speechAnchorCount?: number;
  speechAnchorCoverage?: number;
  segments?: SubtitleTimingSegment[];
  reason: string | null;
}

export type SubtitleAlignmentTrack = "primary" | "secondary";

export interface SubtitleAlignmentBatchResponse {
  results: Partial<Record<SubtitleAlignmentTrack, SubtitleAlignmentResponse>>;
}

export type AlignmentWindowResponse = {
  startAt: number;
  response: SubtitleAlignmentBatchResponse;
};

type AlignmentCluster = {
  candidates: SubtitleAlignmentResponse[];
  averageConfidence: number;
  averageOffsetMs: number;
  score: number;
};

export type AlignmentWindowPlan = {
  startAt: number;
  priority: "nearby" | "buffered" | "fallback";
};

export type AlignmentWindowRequest = (
  plan: AlignmentWindowPlan,
) => Promise<SubtitleAlignmentBatchResponse | null>;

export type SubtitleAlignmentCaption = {
  vttData: string;
  alignmentBaseVttData?: string;
};

export function getSubtitleAlignmentBaseVtt(
  caption: SubtitleAlignmentCaption,
): string {
  return caption.alignmentBaseVttData ?? caption.vttData;
}

export function areSubtitleAlignmentResultsApplicable(
  items: Array<{
    result?: SubtitleAlignmentResponse;
    expectedCaptionId: string;
    currentCaptionId?: string;
    expectedBaseVttData?: string;
    currentBaseVttData?: string;
  }>,
): boolean {
  return (
    items.length > 0 &&
    items.every(
      ({
        result,
        expectedCaptionId,
        currentCaptionId,
        expectedBaseVttData,
        currentBaseVttData,
      }) =>
        result?.aligned === true &&
        currentCaptionId === expectedCaptionId &&
        (expectedBaseVttData === undefined ||
          expectedBaseVttData === currentBaseVttData),
    )
  );
}

export function getSubtitleAlignmentWindowDuration(
  videoDuration?: number,
): number {
  if (
    typeof videoDuration !== "number" ||
    !Number.isFinite(videoDuration) ||
    videoDuration <= 0
  ) {
    return SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS;
  }

  // Files shorter than two minimum extraction windows cannot provide two
  // non-overlapping samples. Keep one full-file window in that case.
  if (videoDuration < SUBTITLE_ALIGNMENT_MIN_AUDIO_WINDOW_SECONDS * 2) {
    return videoDuration;
  }

  // Normal short files use two non-overlapping half-file samples.
  return Math.max(
    Math.min(SUBTITLE_ALIGNMENT_MIN_AUDIO_WINDOW_SECONDS, videoDuration),
    Math.min(SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS, videoDuration / 2),
  );
}

function normalizeHeaders(
  headers: unknown,
): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([, value]) => typeof value === "string" && value.length > 0,
    ),
  );
}

function appendAudio(body: FormData, audio: Uint8Array) {
  const audioCopy = new Uint8Array(audio.byteLength);
  audioCopy.set(audio);
  body.append(
    "audio",
    new Blob([audioCopy.buffer], { type: "audio/wav" }),
    "capture.wav",
  );
}

async function captureCurrentStreamAudio(options: {
  sourceUrl: string;
  startAt: number;
  duration: number;
  headers?: unknown;
}) {
  return await extractAudioWindow({
    url: options.sourceUrl,
    startAt: options.startAt,
    duration: options.duration,
    headers: normalizeHeaders(options.headers),
  });
}

function clampAlignmentWindowStart(
  startAt: number,
  videoDuration?: number,
  windowDuration = SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS,
): number {
  const maxStart =
    typeof videoDuration === "number" &&
    Number.isFinite(videoDuration) &&
    videoDuration > 0
      ? Math.max(0, videoDuration - windowDuration)
      : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(0, startAt), maxStart);
}

function addUniqueAlignmentWindow(
  plans: AlignmentWindowPlan[],
  startAt: number,
  priority: AlignmentWindowPlan["priority"],
  videoDuration?: number,
  windowDuration = SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS,
) {
  const normalizedStart = clampAlignmentWindowStart(
    startAt,
    videoDuration,
    windowDuration,
  );
  const overlapsExistingWindow = plans.some(
    (plan) =>
      normalizedStart < plan.startAt + windowDuration &&
      plan.startAt < normalizedStart + windowDuration,
  );
  if (overlapsExistingWindow) return;
  plans.push({ startAt: normalizedStart, priority });
}

export function buildAlignmentWindowPlan(
  startAt: number,
  videoDuration?: number,
  buffered?: number,
): AlignmentWindowPlan[] {
  const windowDuration = getSubtitleAlignmentWindowDuration(videoDuration);
  const currentStart = clampAlignmentWindowStart(
    startAt,
    videoDuration,
    windowDuration,
  );
  const plans: AlignmentWindowPlan[] = [];

  // The extractor owns a separate libmpv instance. `buffered` cannot make a
  // future window free, but it can prioritize the last likely-ready range.
  addUniqueAlignmentWindow(
    plans,
    currentStart,
    "nearby",
    videoDuration,
    windowDuration,
  );
  if (
    typeof buffered === "number" &&
    Number.isFinite(buffered) &&
    buffered >= windowDuration
  ) {
    addUniqueAlignmentWindow(
      plans,
      buffered - windowDuration,
      "buffered",
      videoDuration,
      windowDuration,
    );
  }

  if (
    plans.length < SUBTITLE_ALIGNMENT_INITIAL_WINDOWS &&
    currentStart >= windowDuration
  ) {
    addUniqueAlignmentWindow(
      plans,
      currentStart - windowDuration,
      "nearby",
      videoDuration,
      windowDuration,
    );
  } else if (plans.length < SUBTITLE_ALIGNMENT_INITIAL_WINDOWS) {
    addUniqueAlignmentWindow(
      plans,
      currentStart + windowDuration,
      "nearby",
      videoDuration,
      windowDuration,
    );
  }

  const maxStart =
    typeof videoDuration === "number" &&
    Number.isFinite(videoDuration) &&
    videoDuration > 0
      ? Math.max(0, videoDuration - windowDuration)
      : null;
  const fallbackStarts =
    maxStart !== null
      ? SUBTITLE_ALIGNMENT_TIMELINE_ANCHOR_FRACTIONS.map((fraction) =>
          Math.round(maxStart * fraction),
        )
      : SUBTITLE_ALIGNMENT_WINDOW_FALLBACK_OFFSETS_SECONDS.map((offset) =>
          Math.round(currentStart + offset),
        );

  for (const fallbackStart of fallbackStarts) {
    addUniqueAlignmentWindow(
      plans,
      fallbackStart,
      "fallback",
      videoDuration,
      windowDuration,
    );
  }

  return plans.slice(0, SUBTITLE_ALIGNMENT_MAX_WINDOWS);
}

function clusterAlignmentCandidates(
  candidates: SubtitleAlignmentResponse[],
): AlignmentCluster[] {
  const sortedCandidates = [...candidates].sort(
    (first, second) => first.offsetMs - second.offsetMs,
  );
  const clusters: AlignmentCluster[] = [];

  for (const candidate of sortedCandidates) {
    const currentCluster = clusters[clusters.length - 1];
    if (
      currentCluster &&
      candidate.offsetMs - currentCluster.candidates[0].offsetMs <=
        SUBTITLE_ALIGNMENT_OFFSET_TOLERANCE_MS
    ) {
      currentCluster.candidates.push(candidate);
      continue;
    }
    clusters.push({
      candidates: [candidate],
      averageConfidence: 0,
      averageOffsetMs: 0,
      score: 0,
    });
  }

  return clusters.map((cluster) => {
    const averageConfidence =
      cluster.candidates.reduce(
        (total, candidate) => total + candidate.confidence,
        0,
      ) / cluster.candidates.length;
    const averageOffsetMs =
      cluster.candidates.reduce(
        (total, candidate) => total + candidate.offsetMs,
        0,
      ) / cluster.candidates.length;

    return {
      ...cluster,
      averageConfidence,
      averageOffsetMs,
      score: cluster.candidates.length * 100 + averageConfidence,
    };
  });
}

function buildUnalignedResult(
  candidates: SubtitleAlignmentResponse[],
  reason: string,
): SubtitleAlignmentResponse {
  const bestCandidate = [...candidates].sort(
    (first, second) => second.confidence - first.confidence,
  )[0];

  return {
    aligned: false,
    offsetMs: 0,
    confidence: bestCandidate?.confidence ?? 0,
    speechIntervals: bestCandidate?.speechIntervals ?? [],
    reason,
  };
}

function hasSpeechEvidence(result: SubtitleAlignmentResponse): boolean {
  return (
    result.reason !== "no_speech_detected" &&
    result.reason !== "insufficient_speech_in_window" &&
    result.speechIntervals.length > 0
  );
}

function getValidAlignmentCandidates(
  candidates: SubtitleAlignmentResponse[],
): SubtitleAlignmentResponse[] {
  return candidates.filter(
    (candidate) =>
      hasSpeechEvidence(candidate) &&
      candidate.aligned &&
      Number.isFinite(candidate.offsetMs) &&
      candidate.confidence >= SUBTITLE_ALIGNMENT_MIN_CONFIDENCE &&
      Math.abs(candidate.offsetMs) <=
        SUBTITLE_ALIGNMENT_MAX_PLAUSIBLE_OFFSET_MS,
  );
}

function hasAlignmentConsensus(
  candidates: SubtitleAlignmentResponse[],
): boolean {
  const validCandidates = getValidAlignmentCandidates(candidates);
  if (validCandidates.length < SUBTITLE_ALIGNMENT_MIN_CONSENSUS_WINDOWS) {
    return false;
  }

  const clusters = clusterAlignmentCandidates(validCandidates).sort(
    (first, second) => second.score - first.score,
  );
  const bestCluster = clusters[0];
  const secondCluster = clusters[1];
  if (!bestCluster) return false;

  const scoreMargin = secondCluster
    ? bestCluster.score - secondCluster.score
    : Number.POSITIVE_INFINITY;
  return (
    bestCluster.candidates.length >= SUBTITLE_ALIGNMENT_MIN_CONSENSUS_WINDOWS &&
    bestCluster.averageConfidence >= SUBTITLE_ALIGNMENT_MIN_CONFIDENCE &&
    scoreMargin >= SUBTITLE_ALIGNMENT_MIN_SCORE_MARGIN
  );
}

function hasConsensusForAllTracks(
  subtitles: Array<{ track: SubtitleAlignmentTrack }>,
  windowResponses: AlignmentWindowResponse[],
): boolean {
  return subtitles.every(({ track }) => {
    const candidates = windowResponses
      .map(({ response }) => response.results[track])
      .filter((result): result is SubtitleAlignmentResponse => result != null);
    return hasAlignmentConsensus(candidates);
  });
}

export async function collectAlignmentWindowResponses(options: {
  windowPlan: AlignmentWindowPlan[];
  subtitles: Array<{ track: SubtitleAlignmentTrack }>;
  signal?: AbortSignal;
  requestWindow: AlignmentWindowRequest;
  onProgress?: (progress: number) => void;
}): Promise<AlignmentWindowResponse[]> {
  const initialWindowPlan = options.windowPlan.slice(
    0,
    Math.min(SUBTITLE_ALIGNMENT_INITIAL_WINDOWS, options.windowPlan.length),
  );
  const fallbackWindowPlan = options.windowPlan.slice(initialWindowPlan.length);
  const windowResponses: AlignmentWindowResponse[] = [];
  const totalWindows = options.windowPlan.length;
  let completedWindows = 0;
  let lastError: unknown = null;

  const requestWindow = async (plan: AlignmentWindowPlan) => {
    if (options.signal?.aborted) {
      throw new DOMException("Subtitle alignment was aborted", "AbortError");
    }

    try {
      const response = await options.requestWindow(plan);
      if (response) {
        windowResponses.push({ startAt: plan.startAt, response });
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
      console.warn("[subtitle-align] window skipped", {
        startAt: plan.startAt,
        priority: plan.priority,
        error,
      });
    }

    completedWindows += 1;
    options.onProgress?.(
      Math.min(1, completedWindows / Math.max(1, totalWindows)),
    );
  };

  for (const plan of initialWindowPlan) {
    await requestWindow(plan);
  }

  if (!hasConsensusForAllTracks(options.subtitles, windowResponses)) {
    for (const plan of fallbackWindowPlan) {
      await requestWindow(plan);
      if (hasConsensusForAllTracks(options.subtitles, windowResponses)) {
        break;
      }
    }
  }

  if (windowResponses.length === 0 && lastError) {
    throw lastError;
  }

  return windowResponses;
}

export interface SubtitleWindowCandidateEntry {
  startAt: number;
  result: SubtitleAlignmentResponse;
}

export function selectSubtitleAlignmentConsensus(
  candidatesOrEntries:
    | SubtitleAlignmentResponse[]
    | SubtitleWindowCandidateEntry[],
): SubtitleAlignmentResponse {
  const entries: SubtitleWindowCandidateEntry[] = candidatesOrEntries.map(
    (item, index) => {
      if ("startAt" in item && "result" in item) {
        return item;
      }
      return {
        startAt: index * 60,
        result: item,
      };
    },
  );

  const candidates = entries.map((e) => e.result);
  const speechCandidates = candidates.filter(hasSpeechEvidence);
  const validEntries = entries.filter(
    (e) =>
      hasSpeechEvidence(e.result) &&
      e.result.aligned &&
      Number.isFinite(e.result.offsetMs) &&
      e.result.confidence >= SUBTITLE_ALIGNMENT_MIN_CONFIDENCE &&
      Math.abs(e.result.offsetMs) <= SUBTITLE_ALIGNMENT_MAX_PLAUSIBLE_OFFSET_MS,
  );

  if (validEntries.length === 0) {
    return buildUnalignedResult(
      candidates,
      speechCandidates.length === 0
        ? "no_speech_detected"
        : "low_alignment_confidence",
    );
  }

  const validCandidates = validEntries.map((e) => e.result);
  const clusters = clusterAlignmentCandidates(validCandidates).sort(
    (first, second) => second.score - first.score,
  );
  const bestCluster = clusters[0];
  const secondCluster = clusters[1];
  const scoreMargin = secondCluster
    ? bestCluster.score - secondCluster.score
    : Number.POSITIVE_INFINITY;
  const hasConsensus =
    bestCluster.candidates.length >= SUBTITLE_ALIGNMENT_MIN_CONSENSUS_WINDOWS &&
    bestCluster.averageConfidence >= SUBTITLE_ALIGNMENT_MIN_CONFIDENCE &&
    scoreMargin >= SUBTITLE_ALIGNMENT_MIN_SCORE_MARGIN;

  // Check for Piecewise Discrepancy (e.g. Intro window has distinct offset vs main movie)
  const introEntry = validEntries.find((e) => e.startAt <= 120);
  const mainEntries = validEntries.filter((e) => e.startAt > 120);

  if (
    introEntry &&
    mainEntries.length > 0 &&
    introEntry.result.confidence >= 75
  ) {
    const mainCandidates = mainEntries.map((e) => e.result);
    const mainClusters = clusterAlignmentCandidates(mainCandidates).sort(
      (a, b) => b.score - a.score,
    );
    const mainBestCluster = mainClusters[0];

    if (
      mainBestCluster &&
      mainBestCluster.averageConfidence >= SUBTITLE_ALIGNMENT_MIN_CONFIDENCE &&
      Math.abs(introEntry.result.offsetMs - mainBestCluster.averageOffsetMs) >
        15_000
    ) {
      const introOffset = Math.round(introEntry.result.offsetMs);
      const mainOffset = Math.round(mainBestCluster.averageOffsetMs);
      const segments: SubtitleTimingSegment[] = [
        {
          startMs: 0,
          endMs: 180_000, // Intro / Recap (first 3 minutes)
          offsetMs: introOffset,
        },
        {
          startMs: 180_000,
          endMs: Number.MAX_SAFE_INTEGER, // Main movie body
          offsetMs: mainOffset,
        },
      ];

      return {
        ...introEntry.result,
        aligned: true,
        offsetMs: mainOffset,
        confidence: Math.round(
          (introEntry.result.confidence + mainBestCluster.averageConfidence) /
            2,
        ),
        segments,
        reason: null,
      };
    }
  }

  if (!hasConsensus) {
    return buildUnalignedResult(
      candidates,
      bestCluster.candidates.length < SUBTITLE_ALIGNMENT_MIN_CONSENSUS_WINDOWS
        ? "insufficient_consensus"
        : "ambiguous_alignment",
    );
  }

  const representative = [...bestCluster.candidates].sort(
    (first, second) => second.confidence - first.confidence,
  )[0];
  return {
    ...representative,
    aligned: true,
    offsetMs: Math.round(bestCluster.averageOffsetMs),
    confidence: Math.round(bestCluster.averageConfidence),
    reason: null,
  };
}

export async function alignSubtitlesWithCurrentStream(options: {
  sourceUrl: string;
  startAt: number;
  language: string;
  subtitles: Array<{
    track: SubtitleAlignmentTrack;
    vttData: string;
  }>;
  headers?: unknown;
  signal?: AbortSignal;
  videoDuration?: number;
  buffered?: number;
  onProgress?: (progress: number) => void;
}): Promise<SubtitleAlignmentBatchResponse> {
  const windowPlan = buildAlignmentWindowPlan(
    options.startAt,
    options.videoDuration,
    options.buffered,
  );
  const windowDuration = getSubtitleAlignmentWindowDuration(
    options.videoDuration,
  );
  const windowResponses = await collectAlignmentWindowResponses({
    windowPlan,
    subtitles: options.subtitles,
    signal: options.signal,
    onProgress: options.onProgress,
    requestWindow: async (plan) => {
      const audio = await captureCurrentStreamAudio({
        ...options,
        startAt: plan.startAt,
        duration: windowDuration,
      });
      const cleanedSubtitles = options.subtitles.map((sub) => ({
        ...sub,
        vttData: removeVttAds(sub.vttData),
      }));
      const body = new FormData();
      appendAudio(body, audio);
      body.append("subtitles", JSON.stringify(cleanedSubtitles));
      body.append("language", options.language || "en");
      body.append("audioStartMs", String(Math.round(plan.startAt * 1000)));

      const response = await mwFetch<SubtitleAlignmentBatchResponse>(
        "/api/subtitle-align",
        {
          method: "POST",
          body,
          baseURL: conf().BACKEND_URL ?? undefined,
          signal: options.signal,
          timeout: 300_000,
        },
      );
      return response;
    },
  });
  options.onProgress?.(1);

  const results: Partial<
    Record<SubtitleAlignmentTrack, SubtitleAlignmentResponse>
  > = {};

  for (const subtitle of options.subtitles) {
    const entries = windowResponses
      .map(({ startAt, response }) => ({
        startAt,
        result: response.results[subtitle.track],
      }))
      .filter(
        (
          entry,
        ): entry is { startAt: number; result: SubtitleAlignmentResponse } =>
          entry.result != null,
      );
    results[subtitle.track] = selectSubtitleAlignmentConsensus(entries);
  }

  return { results };
}

export async function alignSubtitleWithCurrentStream(options: {
  sourceUrl: string;
  startAt: number;
  language: string;
  vttData: string;
  headers?: unknown;
  signal?: AbortSignal;
  videoDuration?: number;
  buffered?: number;
}): Promise<SubtitleAlignmentResponse> {
  const batchResult = await alignSubtitlesWithCurrentStream({
    sourceUrl: options.sourceUrl,
    startAt: options.startAt,
    language: options.language,
    subtitles: [{ track: "primary", vttData: options.vttData }],
    headers: options.headers,
    signal: options.signal,
    videoDuration: options.videoDuration,
    buffered: options.buffered,
  });
  return (
    batchResult.results.primary ?? {
      aligned: false,
      offsetMs: 0,
      confidence: 0,
      speechIntervals: [],
      reason: "no_alignment_result",
    }
  );
}

export function applySubtitleAlignment(
  vttData: string,
  result: SubtitleAlignmentResponse,
): string {
  if (!result.aligned || !Number.isFinite(result.offsetMs)) {
    return vttData;
  }
  if (result.segments && result.segments.length > 0) {
    return shiftVttPiecewiseTimestamps(
      vttData,
      result.segments,
      result.offsetMs,
    );
  }
  return shiftVttTimestamps(vttData, result.offsetMs / 1000);
}
