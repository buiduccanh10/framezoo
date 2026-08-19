import { mwFetch } from "@/backend/helpers/fetch";
import {
  MoonshineLanguageUnavailableError,
  MoonshineModelCancelledError,
  decodeMoonshineWav,
  disableMoonshineForSession,
  ensureMoonshineModel,
  transcribeMoonshine,
} from "@/moonshine/runtime";
import { conf } from "@/setup/config";

import { extractAudioWindow } from "./audioCapture";
import {
  SubtitleTimingSegment,
  shiftVttPiecewiseTimestamps,
  shiftVttTimestamps,
} from "./captions";

export const SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS = 60;
export const SUBTITLE_ALIGNMENT_MAX_WINDOWS = 6;
export const SUBTITLE_ALIGNMENT_TIMELINE_ANCHOR_FRACTIONS = [
  0.15, 0.35, 0.55, 0.75,
];

const SUBTITLE_ALIGNMENT_WINDOW_FALLBACK_OFFSETS_SECONDS = [
  -120, 120, -240, 240,
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
  errorMessage?: string;
  warningMessage?: string;
}

export type AlignmentWindowPlan = {
  startAt: number;
  priority: "nearby" | "buffered" | "fallback";
};

export type SubtitleAlignmentCaption = {
  vttData: string;
  alignmentBaseVttData?: string;
  alignmentSourceVttData?: string;
};

export function getSubtitleAlignmentBaseVtt(
  caption: SubtitleAlignmentCaption,
): string {
  return caption.alignmentBaseVttData ?? caption.vttData;
}

export function getSubtitleAlignmentInputVtt(
  caption: SubtitleAlignmentCaption,
): string {
  return caption.alignmentSourceVttData ?? getSubtitleAlignmentBaseVtt(caption);
}

export function isSubtitleAlignmentResultApplicable(item: {
  result?: SubtitleAlignmentResponse;
  expectedCaptionId: string;
  currentCaptionId?: string;
  expectedBaseVttData?: string;
  currentBaseVttData?: string;
}): boolean {
  return (
    item.result?.aligned === true &&
    item.currentCaptionId === item.expectedCaptionId &&
    (item.expectedBaseVttData === undefined ||
      item.expectedBaseVttData === item.currentBaseVttData)
  );
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
    items.every((item) => isSubtitleAlignmentResultApplicable(item))
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

  if (videoDuration < SUBTITLE_ALIGNMENT_MIN_AUDIO_WINDOW_SECONDS * 2) {
    return videoDuration;
  }

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

function appendAudio(body: FormData, audio: Uint8Array, index: number) {
  const audioCopy = new Uint8Array(audio.byteLength);
  audioCopy.set(audio);
  body.append(
    "audio",
    new Blob([audioCopy.buffer], { type: "audio/wav" }),
    `capture-${index}.wav`,
  );
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException && error.name === "AbortError") ||
    error instanceof MoonshineModelCancelledError
  );
}

async function captureCurrentStreamAudio(options: {
  sourceUrl: string;
  startAt: number;
  duration: number;
  headers?: unknown;
  signal?: AbortSignal;
}) {
  return await extractAudioWindow({
    url: options.sourceUrl,
    startAt: options.startAt,
    duration: options.duration,
    headers: normalizeHeaders(options.headers),
    signal: options.signal,
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

  if (plans.length < 2) {
    if (currentStart >= windowDuration) {
      addUniqueAlignmentWindow(
        plans,
        currentStart - windowDuration,
        "nearby",
        videoDuration,
        windowDuration,
      );
    } else {
      addUniqueAlignmentWindow(
        plans,
        currentStart + windowDuration,
        "nearby",
        videoDuration,
        windowDuration,
      );
    }
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
  onProgress?: (progress: number, phase?: "capturing" | "analyzing") => void;
}): Promise<SubtitleAlignmentBatchResponse> {
  const windowPlan = buildAlignmentWindowPlan(
    options.startAt,
    options.videoDuration,
    options.buffered,
  );
  const windowDuration = getSubtitleAlignmentWindowDuration(
    options.videoDuration,
  );
  const capturedWindows: Array<{
    audio: Uint8Array;
    startMs: number;
  }> = [];
  const windowStartsMs: number[] = [];
  const windowDurationsMs: number[] = [];

  for (const [index, plan] of windowPlan.entries()) {
    const audio = await captureCurrentStreamAudio({
      ...options,
      startAt: plan.startAt,
      duration: windowDuration,
    });
    capturedWindows.push({
      audio,
      startMs: Math.round(plan.startAt * 1000),
    });
    windowStartsMs.push(Math.round(plan.startAt * 1000));
    windowDurationsMs.push(Math.round(windowDuration * 1000));
    options.onProgress?.(((index + 1) / windowPlan.length) * 0.35, "capturing");
  }

  let localSpeechIntervals: Array<
    Array<{ startMs: number; endMs: number }>
  > | null = null;
  let localFallbackWarning: string | undefined;
  try {
    const localEntry = await ensureMoonshineModel(options.language || "en");
    if (localEntry) {
      localSpeechIntervals = [];
      for (const [index, window] of capturedWindows.entries()) {
        const decoded = decodeMoonshineWav(window.audio);
        const localIntervals = await transcribeMoonshine(
          localEntry,
          window.audio,
          options.signal,
        );
        localSpeechIntervals.push(
          localIntervals.map(({ startMs, endMs }) => ({
            startMs: window.startMs + startMs,
            endMs: window.startMs + endMs,
          })),
        );
        windowDurationsMs[index] = decoded.durationMs;
        options.onProgress?.(
          0.35 + ((index + 1) / capturedWindows.length) * 0.35,
          "analyzing",
        );
      }
    }
  } catch (error) {
    if (isAbortError(error, options.signal)) throw error;
    localSpeechIntervals = null;
    if (error instanceof MoonshineLanguageUnavailableError) {
      localFallbackWarning =
        "Local Moonshine không hỗ trợ ngôn ngữ này; đã dùng server fallback.";
    } else {
      disableMoonshineForSession();
      localFallbackWarning =
        "Local Moonshine không khả dụng; đã dùng server fallback.";
    }
    console.warn("[subtitle-align] local Moonshine failed; using server", {
      language: options.language,
      error,
    });
  }

  const body = new FormData();
  body.append(
    "subtitles",
    JSON.stringify(
      options.subtitles.map((subtitle) => ({
        track: subtitle.track,
        vttData: subtitle.vttData,
      })),
    ),
  );
  body.append("language", options.language || "en");
  body.append("windowStartsMs", JSON.stringify(windowStartsMs));
  body.append("windowDurationsMs", JSON.stringify(windowDurationsMs));

  if (localSpeechIntervals) {
    body.append("speechIntervals", JSON.stringify(localSpeechIntervals));
  } else {
    for (const [index, window] of capturedWindows.entries()) {
      appendAudio(body, window.audio, index);
    }
  }
  options.onProgress?.(0.75, "analyzing");

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
  options.onProgress?.(1, "analyzing");
  return localFallbackWarning
    ? { ...response, warningMessage: localFallbackWarning }
    : response;
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
