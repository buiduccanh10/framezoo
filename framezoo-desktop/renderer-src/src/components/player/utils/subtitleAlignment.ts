import { mwFetch } from "@/backend/helpers/fetch";
import { conf } from "@/setup/config";

import { extractAudioWindow } from "./audioCapture";
import { shiftVttTimestamps } from "./captions";

export const SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS = 60;
export const SUBTITLE_ALIGNMENT_MIN_CONFIDENCE = 60;
export const SUBTITLE_ALIGNMENT_MIN_CONSENSUS_WINDOWS = 2;
export const SUBTITLE_ALIGNMENT_OFFSET_TOLERANCE_MS = 750;
export const SUBTITLE_ALIGNMENT_MIN_SCORE_MARGIN = 10;

const SUBTITLE_ALIGNMENT_WINDOW_OFFSETS_SECONDS = [-45, 30, 105];

export interface SubtitleAlignmentResponse {
  aligned: boolean;
  offsetMs: number;
  confidence: number;
  speechIntervals: Array<{
    startMs: number;
    endMs: number;
  }>;
  cleanedVtt: string;
  reason: string | null;
}

export type SubtitleAlignmentTrack = "primary" | "secondary";

export interface SubtitleAlignmentBatchResponse {
  results: Partial<Record<SubtitleAlignmentTrack, SubtitleAlignmentResponse>>;
}

type AlignmentWindowResponse = {
  startAt: number;
  response: SubtitleAlignmentBatchResponse;
};

type AlignmentCluster = {
  candidates: SubtitleAlignmentResponse[];
  averageConfidence: number;
  averageOffsetMs: number;
  score: number;
};

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
  headers?: unknown;
}) {
  return await extractAudioWindow({
    url: options.sourceUrl,
    startAt: options.startAt,
    duration: SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS,
    headers: normalizeHeaders(options.headers),
  });
}

function buildAlignmentWindowStarts(
  startAt: number,
  videoDuration?: number,
): number[] {
  const windowDuration = SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS;
  const maxStart =
    typeof videoDuration === "number" &&
    Number.isFinite(videoDuration) &&
    videoDuration > 0
      ? Math.max(0, videoDuration - windowDuration)
      : Number.POSITIVE_INFINITY;
  const baseStart = Math.min(Math.max(0, startAt), maxStart);
  const starts = SUBTITLE_ALIGNMENT_WINDOW_OFFSETS_SECONDS.map((offset) =>
    Math.min(Math.max(0, baseStart + offset), maxStart),
  );

  return starts.filter(
    (candidate, index) => starts.indexOf(candidate) === index,
  );
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
      candidate.offsetMs -
        currentCluster.candidates[currentCluster.candidates.length - 1]
          .offsetMs <=
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
  vttData: string,
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
    cleanedVtt: vttData,
    reason,
  };
}

export function selectSubtitleAlignmentConsensus(
  vttData: string,
  candidates: SubtitleAlignmentResponse[],
): SubtitleAlignmentResponse {
  const validCandidates = candidates.filter(
    (candidate) =>
      candidate.aligned &&
      Number.isFinite(candidate.offsetMs) &&
      candidate.confidence >= SUBTITLE_ALIGNMENT_MIN_CONFIDENCE,
  );
  if (validCandidates.length === 0) {
    return buildUnalignedResult(
      vttData,
      candidates,
      candidates.length > 0
        ? "low_alignment_confidence"
        : "no_alignment_result",
    );
  }

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

  if (!hasConsensus) {
    return buildUnalignedResult(
      vttData,
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
  onProgress?: (progress: number) => void;
}): Promise<SubtitleAlignmentBatchResponse> {
  const windowStarts = buildAlignmentWindowStarts(
    options.startAt,
    options.videoDuration,
  );
  const windowResponses: AlignmentWindowResponse[] = [];
  let lastError: unknown = null;

  for (let i = 0; i < windowStarts.length; i++) {
    const startAt = windowStarts[i];
    if (options.signal?.aborted) {
      throw new DOMException("Subtitle alignment was aborted", "AbortError");
    }

    try {
      const audio = await captureCurrentStreamAudio({
        ...options,
        startAt,
      });
      const body = new FormData();
      appendAudio(body, audio);
      body.append("subtitles", JSON.stringify(options.subtitles));
      body.append("language", options.language || "en");
      body.append("audioStartMs", String(Math.round(startAt * 1000)));

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
      windowResponses.push({ startAt, response });
      options.onProgress?.((i + 1) / windowStarts.length);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
      console.warn("[subtitle-align] window skipped", {
        startAt,
        error,
      });
      options.onProgress?.((i + 1) / windowStarts.length);
    }
  }

  if (windowResponses.length === 0 && lastError) {
    throw lastError;
  }

  const results: Partial<
    Record<SubtitleAlignmentTrack, SubtitleAlignmentResponse>
  > = {};
  const candidatesByTrack = new Map<
    SubtitleAlignmentTrack,
    SubtitleAlignmentResponse[]
  >();
  for (const subtitle of options.subtitles) {
    const candidates = windowResponses
      .map(({ response }) => response.results[subtitle.track])
      .filter((result): result is SubtitleAlignmentResponse => result != null);
    candidatesByTrack.set(subtitle.track, candidates);
  }

  const primarySubtitle = options.subtitles.find(
    (subtitle) => subtitle.track === "primary",
  );
  if (primarySubtitle) {
    results.primary = selectSubtitleAlignmentConsensus(
      primarySubtitle.vttData,
      candidatesByTrack.get("primary") ?? [],
    );
  }

  for (const subtitle of options.subtitles) {
    if (subtitle.track === "primary") continue;
    results[subtitle.track] = selectSubtitleAlignmentConsensus(
      subtitle.vttData,
      candidatesByTrack.get(subtitle.track) ?? [],
    );
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
}): Promise<SubtitleAlignmentResponse> {
  const audio = await captureCurrentStreamAudio(options);

  const body = new FormData();
  appendAudio(body, audio);
  body.append(
    "vtt",
    new Blob([options.vttData], { type: "text/vtt" }),
    "subtitle.vtt",
  );
  body.append("language", options.language || "en");
  body.append("audioStartMs", String(Math.round(options.startAt * 1000)));

  return await mwFetch<SubtitleAlignmentResponse>("/api/subtitle-align", {
    method: "POST",
    body,
    baseURL: conf().BACKEND_URL ?? undefined,
    signal: options.signal,
    timeout: 300_000,
  });
}

export function applySubtitleAlignment(
  vttData: string,
  result: SubtitleAlignmentResponse,
): string {
  if (!result.aligned || !Number.isFinite(result.offsetMs)) {
    return vttData;
  }
  const cleanedVtt = result.cleanedVtt || vttData;
  return shiftVttTimestamps(cleanedVtt, result.offsetMs / 1000);
}
