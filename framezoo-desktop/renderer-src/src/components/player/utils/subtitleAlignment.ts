import { extractAudioWindow } from "./audioCapture";
import {
  SubtitleTimingSegment,
  applyVttAlignment,
  tryParseCanonicalVtt,
} from "./captions";
import { mwFetch } from "../../../backend/helpers/fetch";
import { conf } from "../../../setup/config";

export const SUBTITLE_ALIGNMENT_AUDIO_WINDOW_SECONDS = 45;
export const SUBTITLE_ALIGNMENT_MAX_WINDOWS = 6;
export const SUBTITLE_ALIGNMENT_TIMELINE_ANCHOR_FRACTIONS = [
  0.12, 0.3, 0.5, 0.7, 0.88, 0.4,
];

const SUBTITLE_ALIGNMENT_WINDOW_FALLBACK_OFFSETS_SECONDS = [
  -120, 120, -240, 240, -360, 360,
];
const SUBTITLE_ALIGNMENT_MIN_AUDIO_WINDOW_SECONDS = 1;
const SUBTITLE_ALIGNMENT_CAPTURE_CONCURRENCY = 4;

function setTorrentSyncFocus(
  sourceUrl: string,
  payload: {
    active: boolean;
    videoDuration?: number;
    windows?: Array<{ startAt: number; duration: number }>;
  },
) {
  if (typeof fetch !== "function") return;
  try {
    const parsed = new URL(sourceUrl);
    if (
      (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
      !/^\/torrent\/[^/]+$/.test(parsed.pathname)
    ) {
      return;
    }
    const controller =
      typeof AbortController === "function" ? new AbortController() : undefined;
    const timer = controller
      ? setTimeout(() => controller.abort(), 2_000)
      : undefined;
    void fetch(`${parsed.origin}${parsed.pathname}/sync-focus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller?.signal,
    })
      .catch(() => {})
      .finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
  } catch {
    // Best-effort hint for local torrent worker
  }
}

export interface SubtitleAlignmentResponse {
  aligned: boolean;
  offsetMs: number;
  rateRatio?: number;
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
  needsMoreSamples?: boolean;
  additionalWindows?: number;
  failedWindowIndices?: number[];
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
    item.currentCaptionId === item.expectedCaptionId
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

function logSyncTelemetry(event: string, fields: Record<string, unknown> = {}) {
  console.info("[subtitle-sync]", event, fields);
}

async function captureCurrentStreamAudio(options: {
  sourceUrl: string;
  startAt: number;
  duration: number;
  audioTrackId?: string;
  headers?: unknown;
  signal?: AbortSignal;
  windowIndex?: number;
}) {
  return await extractAudioWindow({
    url: options.sourceUrl,
    startAt: options.startAt,
    duration: options.duration,
    audioTrackId: options.audioTrackId,
    headers: normalizeHeaders(options.headers),
    signal: options.signal,
    windowIndex: options.windowIndex,
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

const DIALOGUE_NUDGE_RADIUS_SECONDS = 180;
const DIALOGUE_NUDGE_STEP_SECONDS = 15;
const MIN_DIALOGUE_CUES_FOR_NUDGE = 2;

interface DialogueCueSpan {
  startSec: number;
  endSec: number;
}

function extractDialogueCueSpans(subtitleVtts?: string[]): DialogueCueSpan[] {
  if (!subtitleVtts || subtitleVtts.length === 0) return [];

  for (const vtt of subtitleVtts) {
    const cues = tryParseCanonicalVtt(vtt);
    const spans: DialogueCueSpan[] = [];
    for (const cue of cues) {
      const text = (cue.content ?? "").replace(/<[^>]*>/g, " ").trim();
      if (
        !text ||
        /^[♪♫\s]+$/.test(text) ||
        /^(?:\[[^\]]*\]|\([^)]*\))$/.test(text)
      ) {
        continue;
      }
      const startSec = cue.start / 1000;
      const endSec = cue.end / 1000;
      if (
        Number.isFinite(startSec) &&
        Number.isFinite(endSec) &&
        endSec > startSec
      ) {
        spans.push({ startSec, endSec });
      }
    }
    if (spans.length >= MIN_DIALOGUE_CUES_FOR_NUDGE) {
      spans.sort((a, b) => a.startSec - b.startSec);
      return spans;
    }
  }

  return [];
}

function scoreWindowDialogueDensity(
  spans: DialogueCueSpan[],
  windowStart: number,
  windowDuration: number,
): { count: number; speechSeconds: number } {
  const windowEnd = windowStart + windowDuration;
  // Binary search for the first cue that starts at or after windowEnd to bound the scan
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (spans[mid].startSec < windowEnd) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  let count = 0;
  let speechSeconds = 0;
  for (let i = 0; i < lo; i++) {
    const span = spans[i];
    if (span.endSec <= windowStart) continue;
    count += 1;
    speechSeconds +=
      Math.min(span.endSec, windowEnd) - Math.max(span.startSec, windowStart);
  }
  return { count, speechSeconds };
}

function hasWindowOverlap(
  plans: AlignmentWindowPlan[],
  startAt: number,
  windowDuration: number,
): boolean {
  return plans.some(
    (plan) =>
      startAt < plan.startAt + windowDuration &&
      plan.startAt < startAt + windowDuration,
  );
}

function pickDialogueDenseWindowStart(
  anchorStart: number,
  plans: AlignmentWindowPlan[],
  dialogueSpans: DialogueCueSpan[],
  videoDuration: number | undefined,
  windowDuration: number,
): number {
  const clampedAnchor = clampAlignmentWindowStart(
    anchorStart,
    videoDuration,
    windowDuration,
  );
  if (dialogueSpans.length < MIN_DIALOGUE_CUES_FOR_NUDGE) {
    return clampedAnchor;
  }

  const candidateOffsets = [0];
  for (
    let delta = DIALOGUE_NUDGE_STEP_SECONDS;
    delta <= DIALOGUE_NUDGE_RADIUS_SECONDS;
    delta += DIALOGUE_NUDGE_STEP_SECONDS
  ) {
    candidateOffsets.push(delta, -delta);
  }

  let bestStart: number | null = null;
  let bestCount = 0;
  let bestSpeechSeconds = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  const seenStarts = new Set<number>();

  for (const offset of candidateOffsets) {
    const candidate = clampAlignmentWindowStart(
      clampedAnchor + offset,
      videoDuration,
      windowDuration,
    );
    if (seenStarts.has(candidate)) continue;
    seenStarts.add(candidate);
    if (hasWindowOverlap(plans, candidate, windowDuration)) continue;

    const { count, speechSeconds } = scoreWindowDialogueDensity(
      dialogueSpans,
      candidate,
      windowDuration,
    );
    if (count === 0) continue;

    const distance = Math.abs(candidate - clampedAnchor);
    if (
      count > bestCount ||
      (count === bestCount &&
        (speechSeconds > bestSpeechSeconds + 0.5 ||
          (Math.abs(speechSeconds - bestSpeechSeconds) <= 0.5 &&
            distance < bestDistance)))
    ) {
      bestStart = candidate;
      bestCount = count;
      bestSpeechSeconds = speechSeconds;
      bestDistance = distance;
    }
  }

  return bestStart ?? clampedAnchor;
}

export function buildAlignmentWindowPlan(
  startAt: number,
  videoDuration?: number,
  buffered?: number,
  options?: { subtitleVtts?: string[] },
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

  const maxStart =
    typeof videoDuration === "number" &&
    Number.isFinite(videoDuration) &&
    videoDuration > 0
      ? Math.max(0, videoDuration - windowDuration)
      : null;

  if (
    maxStart === null &&
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
  const dialogueSpans = extractDialogueCueSpans(options?.subtitleVtts);

  const fallbackStarts =
    maxStart !== null
      ? SUBTITLE_ALIGNMENT_TIMELINE_ANCHOR_FRACTIONS.map((fraction) =>
          Math.round(maxStart * fraction),
        )
      : SUBTITLE_ALIGNMENT_WINDOW_FALLBACK_OFFSETS_SECONDS.map((offset) =>
          Math.round(currentStart + offset),
        );

  for (const fallbackStart of fallbackStarts) {
    if (plans.length >= SUBTITLE_ALIGNMENT_MAX_WINDOWS) break;
    const targetStart = pickDialogueDenseWindowStart(
      fallbackStart,
      plans,
      dialogueSpans,
      videoDuration,
      windowDuration,
    );
    addUniqueAlignmentWindow(
      plans,
      targetStart,
      "fallback",
      videoDuration,
      windowDuration,
    );
  }

  if (plans.length < 2) {
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
      addUniqueAlignmentWindow(
        plans,
        currentStart >= windowDuration
          ? currentStart - windowDuration
          : currentStart + windowDuration,
        "nearby",
        videoDuration,
        windowDuration,
      );
    }
  }

  return plans.slice(0, SUBTITLE_ALIGNMENT_MAX_WINDOWS);
}

const SUBTITLE_ALIGNMENT_RETRY_ANCHOR_FRACTIONS = Array.from(
  { length: 19 },
  (_, index) => (index + 1) / 20,
);
const SUBTITLE_ALIGNMENT_RETRY_FALLBACK_OFFSETS_SECONDS = [
  -360, 360, -480, 480, -600, 600, -720, 720, -840, 840, -960, 960,
];

function buildRetryAlignmentWindowPlan(
  existingPlans: AlignmentWindowPlan[],
  requestedWindows: number,
  videoDuration: number | undefined,
  windowDuration: number,
  subtitleVtts?: string[],
): AlignmentWindowPlan[] {
  if (requestedWindows <= 0) return [];

  const maxStart =
    typeof videoDuration === "number" &&
    Number.isFinite(videoDuration) &&
    videoDuration > 0
      ? Math.max(0, videoDuration - windowDuration)
      : null;
  const currentStart = existingPlans[0]?.startAt ?? 0;
  const dialogueSpans = extractDialogueCueSpans(subtitleVtts);
  const anchors =
    maxStart !== null
      ? SUBTITLE_ALIGNMENT_RETRY_ANCHOR_FRACTIONS.map((fraction) =>
          Math.round(maxStart * fraction),
        )
      : SUBTITLE_ALIGNMENT_RETRY_FALLBACK_OFFSETS_SECONDS.map((offset) =>
          Math.round(currentStart + offset),
        );

  const occupiedPlans = [...existingPlans];
  const retryPlans: AlignmentWindowPlan[] = [];
  for (const anchor of anchors) {
    if (retryPlans.length >= requestedWindows) break;
    const candidate = pickDialogueDenseWindowStart(
      anchor,
      occupiedPlans,
      dialogueSpans,
      videoDuration,
      windowDuration,
    );
    if (hasWindowOverlap(occupiedPlans, candidate, windowDuration)) continue;
    const retryPlan = { startAt: candidate, priority: "fallback" as const };
    retryPlans.push(retryPlan);
    occupiedPlans.push(retryPlan);
  }

  return retryPlans;
}

export type SubtitleAlignmentTelemetryPhase =
  "capturing" | "preparing" | "analyzing";

export type SubtitleAlignmentTelemetryStage =
  "upload" | "vad" | "correlate" | "consensus";

export interface SubtitleAlignmentWindowTelemetry {
  index: number;
  startAt: number;
  duration: number;
  priority: "nearby" | "buffered" | "fallback";
  status: "queued" | "capturing" | "captured" | "failed";
}

export interface SubtitleAlignmentProgressTelemetry {
  progress: number;
  phase: SubtitleAlignmentTelemetryPhase;
  stage?: SubtitleAlignmentTelemetryStage;
  windows: SubtitleAlignmentWindowTelemetry[];
  capturedCount: number;
  totalWindows: number;
}

export async function alignSubtitlesWithCurrentStream(options: {
  sourceUrl: string;
  startAt: number;
  language: string;
  audioTrackId?: string;
  subtitles: Array<{
    track: SubtitleAlignmentTrack;
    vttData: string;
  }>;
  headers?: unknown;
  signal?: AbortSignal;
  videoDuration?: number;
  buffered?: number;
  isTorrent?: boolean;
  onProgress?: (progress: number, phase?: "capturing" | "analyzing") => void;
  onTelemetry?: (telemetry: SubtitleAlignmentProgressTelemetry) => void;
}): Promise<SubtitleAlignmentBatchResponse> {
  let windowPlan = buildAlignmentWindowPlan(
    options.startAt,
    options.videoDuration,
    options.buffered,
    { subtitleVtts: options.subtitles.map((subtitle) => subtitle.vttData) },
  );
  const windowDuration = getSubtitleAlignmentWindowDuration(
    options.videoDuration,
  );
  const windowTelemetry: SubtitleAlignmentWindowTelemetry[] = windowPlan.map(
    (plan, index) => ({
      index,
      startAt: plan.startAt,
      duration: windowDuration,
      priority: plan.priority,
      status: "queued",
    }),
  );
  const emitTelemetry = (
    progress: number,
    phase: SubtitleAlignmentTelemetryPhase,
    stage?: SubtitleAlignmentTelemetryStage,
  ) => {
    const capturedCount = windowTelemetry.filter(
      (item) => item.status === "captured",
    ).length;
    options.onTelemetry?.({
      progress,
      phase,
      stage,
      windows: windowTelemetry.map((item) => ({ ...item })),
      capturedCount,
      totalWindows: windowTelemetry.length,
    });
  };
  emitTelemetry(0.06, "capturing");
  const capturedAudio = new Array<Uint8Array>(windowPlan.length);
  const initialWindowCount = windowPlan.length;
  const captureAbortController = new AbortController();
  const abortCaptures = () => {
    captureAbortController.abort();
  };
  options.signal?.addEventListener("abort", abortCaptures, { once: true });
  if (options.signal?.aborted) {
    captureAbortController.abort();
  }
  let completedCaptures = 0;
  let nextCaptureIndex = 0;
  const processWindow = async (
    index: number,
    plan = windowPlan[index],
    reportProgress = true,
  ) => {
    if (!plan) return;
    if (windowTelemetry[index]) {
      windowTelemetry[index].status = "capturing";
      emitTelemetry(
        reportProgress
          ? 0.06 + (completedCaptures / Math.max(1, initialWindowCount)) * 0.42
          : 0.64,
        reportProgress ? "capturing" : "analyzing",
        reportProgress ? undefined : "vad",
      );
    }
    try {
      const audio = await captureCurrentStreamAudio({
        ...options,
        startAt: plan.startAt,
        duration: windowDuration,
        windowIndex: index,
        signal: captureAbortController.signal,
      });
      capturedAudio[index] = audio;
      if (windowTelemetry[index]) {
        windowTelemetry[index].status = "captured";
      }
      if (index === 0) {
        logSyncTelemetry("first_audio_window_ready", {
          windowIndex: index,
          startAt: plan.startAt,
          duration: windowDuration,
        });
      }
    } catch (error) {
      if (windowTelemetry[index]) {
        windowTelemetry[index].status = "failed";
      }
      if (
        captureAbortController.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw error;
      }
      logSyncTelemetry("audio_window_failed", {
        windowIndex: index,
        startAt: plan.startAt,
        duration: windowDuration,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      completedCaptures += 1;
      if (reportProgress) {
        options.onProgress?.(
          (completedCaptures / initialWindowCount) * 0.4,
          "capturing",
        );
        emitTelemetry(
          0.06 + (completedCaptures / initialWindowCount) * 0.42,
          "capturing",
        );
      } else {
        emitTelemetry(0.7, "analyzing", "vad");
      }
    }
  };
  const captureWorker = async (reportProgress = true) => {
    try {
      while (nextCaptureIndex < windowPlan.length) {
        const index = nextCaptureIndex++;
        await processWindow(index, undefined, reportProgress);
      }
    } catch (error) {
      captureAbortController.abort();
      throw error;
    }
  };
  if (options.isTorrent) {
    setTorrentSyncFocus(options.sourceUrl, {
      active: true,
      videoDuration: options.videoDuration,
      windows: windowPlan.map((plan) => ({
        startAt: plan.startAt,
        duration: windowDuration,
      })),
    });
  }
  try {
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            SUBTITLE_ALIGNMENT_CAPTURE_CONCURRENCY,
            windowPlan.length,
          ),
        },
        () => captureWorker(),
      ),
    );
    logSyncTelemetry("all_audio_windows_ready", {
      windowCount: capturedAudio.filter(Boolean).length,
      plannedWindowCount: windowPlan.length,
      windowDuration,
    });
  } finally {
    if (options.isTorrent) {
      setTorrentSyncFocus(options.sourceUrl, { active: false });
    }
    options.signal?.removeEventListener("abort", abortCaptures);
  }

  emitTelemetry(0.52, "preparing", "upload");

  // ponytail: keep alignment off the renderer thread; reintroduce local inference
  // only behind a Worker with transferable audio buffers.
  // The renderer captures bounded audio windows and applies the server result.
  const buildAlignmentPayload = (indices?: number[]) => {
    const capturedWindows: Array<{ audio: Uint8Array; startMs: number }> = [];
    const windowStartsMs: number[] = [];
    const windowDurationsMs: number[] = [];
    const sentIndices: number[] = [];
    const selectedIndices = new Set(
      indices ?? windowPlan.map((_, index) => index),
    );
    const timelineWindows = windowPlan
      .map((plan, index) => ({ index, plan }))
      .sort((left, right) => left.plan.startAt - right.plan.startAt);

    for (const { index, plan } of timelineWindows) {
      if (!selectedIndices.has(index)) continue;
      const audio = capturedAudio[index];
      if (!audio) continue;
      capturedWindows.push({ audio, startMs: Math.round(plan.startAt * 1000) });
      windowStartsMs.push(Math.round(plan.startAt * 1000));
      windowDurationsMs.push(Math.round(windowDuration * 1000));
      sentIndices.push(index);
    }

    if (capturedWindows.length === 0) {
      throw new Error(
        "Failed to capture any valid audio windows for alignment",
      );
    }
    return { capturedWindows, windowStartsMs, windowDurationsMs, sentIndices };
  };

  const submitAlignment = async (progress: number, indices?: number[]) => {
    const { capturedWindows, windowStartsMs, windowDurationsMs, sentIndices } =
      buildAlignmentPayload(indices);
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
    for (const [index, window] of capturedWindows.entries()) {
      appendAudio(body, window.audio, index);
    }

    options.onProgress?.(progress, "analyzing");
    emitTelemetry(progress, "analyzing", "vad");
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
    return { response, sentIndices };
  };

  const firstSubmission = await submitAlignment(0.58);
  let response = firstSubmission.response;
  const firstSentIndices = firstSubmission.sentIndices;
  const reportedAdditionalWindows = response.additionalWindows;
  const requestedRetryWindows = Math.min(
    SUBTITLE_ALIGNMENT_MAX_WINDOWS,
    response.needsMoreSamples === true
      ? Math.max(
          0,
          typeof reportedAdditionalWindows === "number" &&
            Number.isFinite(reportedAdditionalWindows)
            ? Math.floor(reportedAdditionalWindows)
            : 1,
        )
      : 0,
  );
  if (requestedRetryWindows > 0) {
    const retryPlans = buildRetryAlignmentWindowPlan(
      windowPlan,
      requestedRetryWindows,
      options.videoDuration,
      windowDuration,
      options.subtitles.map((subtitle) => subtitle.vttData),
    );
    if (retryPlans.length > 0) {
      const retryStartIndex = windowPlan.length;
      windowPlan = [...windowPlan, ...retryPlans];
      retryPlans.forEach((retryPlan, index) => {
        windowTelemetry.push({
          index: retryStartIndex + index,
          startAt: retryPlan.startAt,
          duration: windowDuration,
          priority: retryPlan.priority,
          status: "queued",
        });
      });
      const retryIndices = retryPlans.map(
        (_, index) => retryStartIndex + index,
      );
      options.signal?.addEventListener("abort", abortCaptures, { once: true });
      if (options.signal?.aborted) captureAbortController.abort();
      try {
        if (options.isTorrent) {
          setTorrentSyncFocus(options.sourceUrl, {
            active: true,
            videoDuration: options.videoDuration,
            windows: retryPlans.map((plan) => ({
              startAt: plan.startAt,
              duration: windowDuration,
            })),
          });
        }
        try {
          await Promise.all(
            Array.from(
              {
                length: Math.min(
                  SUBTITLE_ALIGNMENT_CAPTURE_CONCURRENCY,
                  retryPlans.length,
                ),
              },
              () => captureWorker(false),
            ),
          );
        } finally {
          if (options.isTorrent) {
            setTorrentSyncFocus(options.sourceUrl, { active: false });
          }
        }
        const retryPayload = buildAlignmentPayload(retryIndices);
        if (retryPayload.capturedWindows.length > 0) {
          let submitIndices = retryPayload.sentIndices;
          if (
            Array.isArray(response.failedWindowIndices) &&
            response.failedWindowIndices.length > 0
          ) {
            const failedSet = new Set(response.failedWindowIndices);
            const survivingInitialIndices = firstSentIndices.filter(
              (_, pos) => !failedSet.has(pos),
            );
            submitIndices = [
              ...survivingInitialIndices,
              ...retryPayload.sentIndices,
            ].slice(0, SUBTITLE_ALIGNMENT_MAX_WINDOWS);
          }
          response = (await submitAlignment(0.76, submitIndices)).response;
        }
      } catch (error) {
        if (options.signal?.aborted) throw error;
        logSyncTelemetry("alignment_retry_failed", {
          windowCount: retryPlans.length,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        options.signal?.removeEventListener("abort", abortCaptures);
      }
    }
  }
  logSyncTelemetry("alignment_complete", {
    windowCount: buildAlignmentPayload().capturedWindows.length,
    windowDuration,
  });
  options.onProgress?.(1, "analyzing");
  emitTelemetry(0.95, "analyzing", "consensus");
  // Discard any server-side warningMessage — we don't surface fallback details to users
  return { ...response, warningMessage: undefined };
}

export async function alignSubtitleWithCurrentStream(options: {
  sourceUrl: string;
  startAt: number;
  language: string;
  audioTrackId?: string;
  vttData: string;
  headers?: unknown;
  signal?: AbortSignal;
  videoDuration?: number;
  buffered?: number;
  isTorrent?: boolean;
}): Promise<SubtitleAlignmentResponse> {
  const batchResult = await alignSubtitlesWithCurrentStream({
    sourceUrl: options.sourceUrl,
    startAt: options.startAt,
    language: options.language,
    audioTrackId: options.audioTrackId,
    subtitles: [{ track: "primary", vttData: options.vttData }],
    headers: options.headers,
    signal: options.signal,
    videoDuration: options.videoDuration,
    buffered: options.buffered,
    isTorrent: options.isTorrent,
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
  return applyVttAlignment(vttData, result);
}
