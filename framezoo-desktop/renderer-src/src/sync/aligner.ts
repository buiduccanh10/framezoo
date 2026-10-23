import { findTopOffsetsFft } from "./fft";
import {
  TimingSegment,
  WindowSyncEntry,
  computePiecewiseSegments,
} from "./split";
import { detectSpeechIntervals } from "./vad";

export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface LocalAlignmentResult {
  aligned: boolean;
  offsetMs: number;
  confidence: number;
  speechIntervals: Array<{ startMs: number; endMs: number }>;
  speechAnchorCount?: number;
  speechAnchorCoverage?: number;
  segments?: TimingSegment[];
  framerateRatio?: number;
  reason: string | null;
}

const MIN_ALIGNMENT_CONFIDENCE = 60;
const MIN_ALIGNMENT_SPEECH_DURATION_MS = 1_000;
const MAX_ALIGNMENT_OFFSET_MS = 45_000;
const MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS = 180_000;
const SEARCH_STEP_MS = 250;
const REFINE_RANGE_MS = 750;
const REFINE_STEP_MS = 25;
const SUBTITLE_ACTIVITY_MERGE_GAP_MS = 250;
const MAX_SPEECH_ANCHOR_ERROR_MS = 1_800;
const MIN_SPEECH_ANCHOR_OVERLAP_MS = 120;
const MIN_SPEECH_ANCHOR_COVERAGE = 0.2;
const MIN_SPEECH_ANCHOR_COVERAGE_2_ANCHORS = 0.25;
const SUBTITLE_EARLY_START_GRACE_MS = 250;
const SPEECH_ANCHOR_START_WEIGHT = 0.65;
const SPEECH_ANCHOR_END_WEIGHT = 0.35;
const SPEECH_ANCHOR_EARLY_START_PENALTY_WEIGHT = 0.15;

const CREDIT_AD_RE =
  /https?:\/\/|www\.|osdb\.link|\.(?:org|com|net|link|tv|me|app)\b|opensubtitles|subscene|addic7ed|podnapisi|yify|rarbg|\bpsa\b|vip\s*member|remove\s*all\s*ads|watch\s*online|support\s*us|subtitles?\s*(?:by|downloaded|created|sync)|synced?\s*by|resync\s*by|corrected\s*by|dịch\s*bởi|biên\s*dịch|thực\s*hiện\s*bởi|vietsub\s*bởi|phimmoi|xemphim|motphim|bilutv|tvhay/i;

const MALFORMED_ENCODING_RE =
  /\ufffd|[\u0080-\u009f]|(?:\u00c3|\u00c2)[\u0080-\u00bf]|\u00e2(?:[\u0080-\u00bf]|\u20ac|\u2122|\u0153|\u2013|\u2014)|\u00f0[\u0080-\u00bf]/;

const SDH_BRACKET_RE = /\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|<[^>]+>|[♪♫♬♩]+/g;
const PURE_MUSIC_CUE_RE = /^\s*[♪♫♬♩\s\-~]+\s*$|^\s*[♪♫♬♩].*[♪♫♬♩]\s*$/;

const TIMING_LINE_RE =
  /^\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{3})?)\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{3})?)(?:\s+.*)?$/;

export function parseTimestampToMs(timestamp: string): number {
  const parts = timestamp.trim().replace(",", ".").split(":");
  let seconds = 0;
  if (parts.length === 3) {
    seconds =
      parseFloat(parts[0]!) * 3600 +
      parseFloat(parts[1]!) * 60 +
      parseFloat(parts[2]!);
  } else if (parts.length === 2) {
    seconds = parseFloat(parts[0]!) * 60 + parseFloat(parts[1]!);
  } else {
    seconds = parseFloat(parts[0]!);
  }
  return Math.round(seconds * 1000);
}

export function parseVttCues(vttContent: string): SubtitleCue[] {
  const lines = vttContent
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const cues: SubtitleCue[] = [];
  let currentStartMs: number | null = null;
  let currentEndMs: number | null = null;
  let textLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = TIMING_LINE_RE.exec(trimmed);
    if (match) {
      if (currentStartMs !== null && currentEndMs !== null) {
        cues.push({
          startMs: currentStartMs,
          endMs: currentEndMs,
          text: textLines.join(" ").trim(),
        });
      }
      currentStartMs = parseTimestampToMs(match[1]!);
      currentEndMs = parseTimestampToMs(match[2]!);
      textLines = [];
    } else if (currentStartMs !== null && trimmed.length > 0) {
      if (!trimmed.startsWith("NOTE") && !trimmed.startsWith("WEBVTT")) {
        textLines.push(trimmed);
      }
    } else if (
      trimmed.length === 0 &&
      currentStartMs !== null &&
      currentEndMs !== null
    ) {
      cues.push({
        startMs: currentStartMs,
        endMs: currentEndMs,
        text: textLines.join(" ").trim(),
      });
      currentStartMs = null;
      currentEndMs = null;
      textLines = [];
    }
  }

  if (currentStartMs !== null && currentEndMs !== null) {
    cues.push({
      startMs: currentStartMs,
      endMs: currentEndMs,
      text: textLines.join(" ").trim(),
    });
  }

  return cues;
}

export function decodeWav(data: Uint8Array): {
  samples: Float32Array;
  sampleRate: number;
  durationMs: number;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.byteLength < 44 || view.getUint32(0, false) !== 0x52494646) {
    throw new Error("Invalid WAV header");
  }

  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  // Locate data chunk
  let dataOffset = 12;
  let dataLength = 0;
  while (dataOffset + 8 <= data.byteLength) {
    const chunkId = view.getUint32(dataOffset, false);
    const chunkSize = view.getUint32(dataOffset + 4, true);
    if (chunkId === 0x64617461) {
      // 'data'
      dataOffset += 8;
      dataLength = chunkSize;
      break;
    }
    dataOffset += 8 + chunkSize + (chunkSize & 1);
  }

  if (dataLength <= 0 || dataOffset + dataLength > data.byteLength) {
    dataOffset = 44;
    dataLength = data.byteLength - 44;
  }

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataLength / (channels * bytesPerSample));
  const samples = new Float32Array(totalSamples);

  if (bitsPerSample === 16) {
    for (let i = 0; i < totalSamples; i++) {
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) {
        sum += view.getInt16(dataOffset + (i * channels + ch) * 2, true);
      }
      samples[i] = sum / channels / 32768.0;
    }
  } else if (bitsPerSample === 32) {
    for (let i = 0; i < totalSamples; i++) {
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) {
        sum += view.getFloat32(dataOffset + (i * channels + ch) * 4, true);
      }
      samples[i] = sum / channels;
    }
  } else {
    throw new Error(`Unsupported WAV bits per sample: ${bitsPerSample}`);
  }

  // Amplitude normalization: if audio is very quiet (e.g. downmixed cinema track), boost to nominal range
  let maxAbs = 0;
  for (let i = 0; i < totalSamples; i++) {
    const val = Math.abs(samples[i]!);
    if (val > maxAbs) maxAbs = val;
  }
  if (maxAbs > 0.0001 && maxAbs < 0.25) {
    const scale = 0.5 / maxAbs;
    for (let i = 0; i < totalSamples; i++) {
      samples[i] = Math.max(-1, Math.min(1, samples[i]! * scale));
    }
  }

  const durationMs = Math.round((totalSamples * 1000) / sampleRate);
  return { samples, sampleRate, durationMs };
}

export function isCreditOrAdCue(cue: SubtitleCue): boolean {
  return CREDIT_AD_RE.test(cue.text);
}

export function isMalformedEncodingCue(cue: SubtitleCue): boolean {
  if (!cue.text) return false;
  return MALFORMED_ENCODING_RE.test(cue.text);
}

export function isNonSpeechSdhCue(cue: SubtitleCue): boolean {
  const text = cue.text.trim();
  if (!text) return true;
  if (PURE_MUSIC_CUE_RE.test(text)) return true;
  const cleaned = text
    .replace(SDH_BRACKET_RE, " ")
    .replace(/^\s*[-–—]?\s*[A-ZÀ-Ỹ0-9\s]{1,20}:\s*/, "");
  return !/[\p{L}\p{N}]/u.test(cleaned);
}

export function filterAlignmentCues(cues: SubtitleCue[]): SubtitleCue[] {
  const usable = cues.filter(
    (c) =>
      c.endMs > c.startMs &&
      !isCreditOrAdCue(c) &&
      !isMalformedEncodingCue(c) &&
      !isNonSpeechSdhCue(c),
  );
  if (usable.length > 0) return usable;

  const nonAd = cues.filter(
    (c) =>
      c.endMs > c.startMs && !isCreditOrAdCue(c) && !isMalformedEncodingCue(c),
  );
  if (nonAd.length > 0) return nonAd;

  return cues.filter((c) => c.endMs > c.startMs && !isMalformedEncodingCue(c));
}

function overlapMs(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): number {
  return Math.max(
    0,
    Math.min(firstEnd, secondEnd) - Math.max(firstStart, secondStart),
  );
}

function clipIntervals(
  intervals: Array<[number, number]>,
  startMs: number,
  endMs: number,
): Array<[number, number]> {
  const clipped: Array<[number, number]> = [];
  for (const [ivStart, ivEnd] of intervals) {
    const cs = Math.max(startMs, ivStart);
    const ce = Math.min(endMs, ivEnd);
    if (ce > cs) clipped.push([cs, ce]);
  }
  return clipped;
}

function mergeActivityIntervals(
  intervals: Array<[number, number]>,
  maxGapMs: number,
): Array<[number, number]> {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [startMs, endMs] of sorted) {
    if (endMs <= startMs) continue;
    const prev = merged[merged.length - 1];
    if (prev && startMs <= prev[1] + maxGapMs) {
      prev[1] = Math.max(prev[1], endMs);
    } else {
      merged.push([startMs, endMs]);
    }
  }
  return merged;
}

function totalIntervalOverlap(
  first: Array<[number, number]>,
  second: Array<[number, number]>,
): number {
  let total = 0;
  let secondIdx = 0;
  for (const [fStart, fEnd] of first) {
    while (secondIdx < second.length && second[secondIdx]![1] <= fStart) {
      secondIdx++;
    }
    let idx = secondIdx;
    while (idx < second.length) {
      const [sStart, sEnd] = second[idx]!;
      if (sStart >= fEnd) break;
      total += overlapMs(fStart, fEnd, sStart, sEnd);
      idx++;
    }
  }
  return total;
}

function buildShiftedSubtitleIntervals(
  cues: SubtitleCue[],
  offsetMs: number,
  audioStartMs: number,
  audioEndMs: number,
): Array<[number, number]> {
  const minCueEnd = audioStartMs - offsetMs;
  const maxCueStart = audioEndMs - offsetMs;
  const shifted: Array<[number, number]> = [];
  for (const cue of cues) {
    if (cue.endMs > minCueEnd && cue.startMs < maxCueStart) {
      shifted.push([cue.startMs + offsetMs, cue.endMs + offsetMs]);
    }
  }
  return mergeActivityIntervals(
    clipIntervals(shifted, audioStartMs, audioEndMs),
    SUBTITLE_ACTIVITY_MERGE_GAP_MS,
  );
}

function matchSpeechAnchorBoundaries(
  speechIntervals: Array<[number, number]>,
  subtitleIntervals: Array<[number, number]>,
): { matchedAnchors: number; anchorErrors: Array<[number, number, number]> } {
  const usedSubtitleIndices = new Set<number>();
  const anchorErrors: Array<[number, number, number]> = [];
  let lastSubtitleIndex = -1;

  for (const [speechStart, speechEnd] of speechIntervals) {
    let bestSpan: [number, number] | null = null;
    let bestRank: [number, number] | null = null;
    const speechDuration = speechEnd - speechStart;

    for (let index = 0; index < subtitleIntervals.length; index++) {
      if (usedSubtitleIndices.has(index) || index <= lastSubtitleIndex) {
        continue;
      }
      const [subtitleStart, subtitleEnd] = subtitleIntervals[index]!;
      const ov = overlapMs(speechStart, speechEnd, subtitleStart, subtitleEnd);
      if (ov < MIN_SPEECH_ANCHOR_OVERLAP_MS) continue;

      let chainEndIdx = index;
      let chainEndMs = subtitleEnd;
      let chainOverlap = ov;
      while (chainEndIdx + 1 < subtitleIntervals.length) {
        const nextIdx = chainEndIdx + 1;
        if (usedSubtitleIndices.has(nextIdx)) break;
        const [nextStart, nextEnd] = subtitleIntervals[nextIdx]!;
        if (nextStart - chainEndMs > 900) break;
        const nextOv = overlapMs(speechStart, speechEnd, nextStart, nextEnd);
        if (nextOv < MIN_SPEECH_ANCHOR_OVERLAP_MS) break;
        if (
          Math.abs(speechEnd - nextEnd) <=
          Math.abs(speechEnd - chainEndMs) + 250
        ) {
          chainEndIdx = nextIdx;
          chainEndMs = nextEnd;
          chainOverlap += nextOv;
        } else {
          break;
        }
      }

      const candidates: Array<[number, number, number]> = [
        [index, subtitleEnd, ov],
        [chainEndIdx, chainEndMs, chainOverlap],
      ];

      for (const [candEndIdx, effEndMs, effOverlap] of candidates) {
        const startError = Math.abs(speechStart - subtitleStart);
        const endError = Math.abs(speechEnd - effEndMs);
        const earlyStartError = Math.max(
          0,
          speechStart - subtitleStart - SUBTITLE_EARLY_START_GRACE_MS,
        );
        const boundaryError = Math.max(startError, endError);
        const weightedBoundaryError =
          startError * SPEECH_ANCHOR_START_WEIGHT +
          endError * SPEECH_ANCHOR_END_WEIGHT +
          earlyStartError * SPEECH_ANCHOR_EARLY_START_PENALTY_WEIGHT;
        const overlapRatio =
          effOverlap /
          Math.max(
            MIN_SPEECH_ANCHOR_OVERLAP_MS,
            Math.min(speechDuration, effEndMs - subtitleStart),
          );
        if (boundaryError > MAX_SPEECH_ANCHOR_ERROR_MS && overlapRatio < 0.25) {
          continue;
        }
        const rank: [number, number] = [
          Math.min(1.0, overlapRatio),
          -weightedBoundaryError,
        ];
        if (
          bestRank === null ||
          rank[0] > bestRank[0] ||
          (rank[0] === bestRank[0] && rank[1] > bestRank[1])
        ) {
          bestSpan = [index, candEndIdx];
          bestRank = rank;
        }
      }
    }

    if (bestSpan === null || bestRank === null) {
      if (lastSubtitleIndex >= 0 && anchorErrors.length > 0) {
        const [prevSubStart, prevSubEnd] =
          subtitleIntervals[lastSubtitleIndex]!;
        const tailOv = overlapMs(
          speechStart,
          speechEnd,
          prevSubStart,
          prevSubEnd,
        );
        if (
          tailOv >=
            Math.max(
              MIN_SPEECH_ANCHOR_OVERLAP_MS,
              Math.floor(speechDuration * 0.5),
            ) &&
          Math.abs(speechEnd - prevSubEnd) <= MAX_SPEECH_ANCHOR_ERROR_MS
        ) {
          const prevErr = anchorErrors[anchorErrors.length - 1]!;
          const newEndErr = Math.abs(speechEnd - prevSubEnd);
          anchorErrors[anchorErrors.length - 1] = [
            prevErr[0],
            newEndErr,
            prevErr[2],
          ];
          anchorErrors.push([prevErr[0], newEndErr, 0]);
        }
      }
      continue;
    }

    const [spanStartIdx, spanEndIdx] = bestSpan;
    for (let idx = spanStartIdx; idx <= spanEndIdx; idx++) {
      usedSubtitleIndices.add(idx);
    }
    lastSubtitleIndex = spanEndIdx;
    const subStart = subtitleIntervals[spanStartIdx]![0];
    const subEnd = subtitleIntervals[spanEndIdx]![1];
    anchorErrors.push([
      Math.abs(speechStart - subStart),
      Math.abs(speechEnd - subEnd),
      Math.max(0, speechStart - subStart - SUBTITLE_EARLY_START_GRACE_MS),
    ]);
  }

  return { matchedAnchors: anchorErrors.length, anchorErrors };
}

export interface OffsetEvidence {
  score: number;
  matchedAnchors: number;
  speechAnchorCount: number;
  anchorCoverage: number;
  medianAnchorErrorMs: number;
}

export function evaluateOffset(
  cues: SubtitleCue[],
  speechIntervals: Array<[number, number]>,
  offsetMs: number,
  audioStartMs: number,
  audioEndMs: number,
): OffsetEvidence {
  if (cues.length === 0 || speechIntervals.length === 0) {
    return {
      score: 0,
      matchedAnchors: 0,
      speechAnchorCount: 0,
      anchorCoverage: 0,
      medianAnchorErrorMs: 0,
    };
  }

  const speechActivity = clipIntervals(
    speechIntervals,
    audioStartMs,
    audioEndMs,
  );
  const subtitleActivity = buildShiftedSubtitleIntervals(
    cues,
    offsetMs,
    audioStartMs,
    audioEndMs,
  );
  if (speechActivity.length === 0 || subtitleActivity.length === 0) {
    return {
      score: 0,
      matchedAnchors: 0,
      speechAnchorCount: speechActivity.length,
      anchorCoverage: 0,
      medianAnchorErrorMs: 0,
    };
  }

  let speechDuration = 0;
  for (const [s, e] of speechActivity) speechDuration += e - s;
  let subtitleDuration = 0;
  for (const [s, e] of subtitleActivity) subtitleDuration += e - s;
  const overlapDuration = totalIntervalOverlap(
    speechActivity,
    subtitleActivity,
  );
  const unionDuration = speechDuration + subtitleDuration - overlapDuration;
  if (speechDuration <= 0 || subtitleDuration <= 0 || unionDuration <= 0) {
    return {
      score: 0,
      matchedAnchors: 0,
      speechAnchorCount: speechActivity.length,
      anchorCoverage: 0,
      medianAnchorErrorMs: 0,
    };
  }

  const { matchedAnchors, anchorErrors } = matchSpeechAnchorBoundaries(
    speechActivity,
    subtitleActivity,
  );
  const anchorCoverage = matchedAnchors / speechActivity.length;
  const startErrors = anchorErrors.map((e) => e[0]).sort((a, b) => a - b);
  const endErrors = anchorErrors.map((e) => e[1]).sort((a, b) => a - b);
  const earlyStartErrors = anchorErrors.map((e) => e[2]).sort((a, b) => a - b);

  const medianStartErrorMs =
    startErrors.length > 0
      ? startErrors[Math.floor(startErrors.length / 2)]!
      : MAX_SPEECH_ANCHOR_ERROR_MS;
  const medianEndErrorMs =
    endErrors.length > 0
      ? endErrors[Math.floor(endErrors.length / 2)]!
      : MAX_SPEECH_ANCHOR_ERROR_MS;
  const medianEarlyStartErrorMs =
    earlyStartErrors.length > 0
      ? earlyStartErrors[Math.floor(earlyStartErrors.length / 2)]!
      : 0;
  const medianAnchorErrorMs =
    anchorErrors.length > 0
      ? Math.round(
          medianStartErrorMs * SPEECH_ANCHOR_START_WEIGHT +
            medianEndErrorMs * SPEECH_ANCHOR_END_WEIGHT +
            medianEarlyStartErrorMs * SPEECH_ANCHOR_EARLY_START_PENALTY_WEIGHT,
        )
      : MAX_SPEECH_ANCHOR_ERROR_MS;

  const speechRecall = overlapDuration / speechDuration;
  const subtitlePrecision = overlapDuration / subtitleDuration;
  const activityIou = overlapDuration / unionDuration;
  const startScore = Math.max(
    0,
    1 - medianStartErrorMs / MAX_SPEECH_ANCHOR_ERROR_MS,
  );
  const endScore = Math.max(
    0,
    1 - medianEndErrorMs / MAX_SPEECH_ANCHOR_ERROR_MS,
  );
  const earlyStartPenalty = Math.min(
    1,
    medianEarlyStartErrorMs / MAX_SPEECH_ANCHOR_ERROR_MS,
  );
  const boundaryScore = Math.max(
    0,
    startScore * SPEECH_ANCHOR_START_WEIGHT +
      endScore * SPEECH_ANCHOR_END_WEIGHT -
      earlyStartPenalty * SPEECH_ANCHOR_EARLY_START_PENALTY_WEIGHT,
  );

  let score =
    activityIou * 0.3 +
    speechRecall * 0.2 +
    subtitlePrecision * 0.15 +
    anchorCoverage * 0.25 +
    boundaryScore * 0.1;
  if (matchedAnchors === 0) {
    score *= 0.5;
  }

  return {
    score: Math.min(1, score),
    matchedAnchors,
    speechAnchorCount: speechActivity.length,
    anchorCoverage,
    medianAnchorErrorMs,
  };
}

function computeTrackSearchCenters(
  cues: SubtitleCue[],
  speechIntervals: Array<[number, number]>,
  additionalHints: number[] = [],
  maxOffsetMs = MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS,
): number[] {
  const centers = new Set<number>([0]);
  for (const hint of additionalHints) {
    if (Math.abs(hint) <= maxOffsetMs) centers.add(hint);
  }
  if (cues.length > 0 && speechIntervals.length > 0) {
    const speechFirstMs = speechIntervals[0]![0];
    let nearestCue = cues[0]!;
    let bestDist = Math.abs(nearestCue.startMs - speechFirstMs);
    for (const cue of cues) {
      const d = Math.abs(cue.startMs - speechFirstMs);
      if (d < bestDist) {
        bestDist = d;
        nearestCue = cue;
      }
    }
    for (const anchorStartMs of [cues[0]!.startMs, nearestCue.startMs]) {
      const guided = speechFirstMs - anchorStartMs;
      if (Math.abs(guided) <= maxOffsetMs) centers.add(guided);
    }
  }
  return [...centers].sort((a, b) => a - b);
}

export function findBestOffsetLocal(
  cues: SubtitleCue[],
  speechIntervals: Array<[number, number]>,
  audioStartMs: number,
  audioEndMs: number,
  searchCenters: number[] | null = null,
): { offsetMs: number; score: number } {
  const cueIntervals: Array<[number, number]> = cues.map((c) => [
    c.startMs,
    c.endMs,
  ]);
  const fftPeaks = findTopOffsetsFft(
    speechIntervals,
    cueIntervals,
    audioStartMs,
    audioEndMs,
    MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS,
    false,
    searchCenters,
    5,
  );
  const centersSet = new Set<number>(searchCenters ?? [0]);
  for (const peak of fftPeaks) {
    if (
      peak.confidence >= 15 &&
      Math.abs(peak.offsetMs) <= MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS
    ) {
      centersSet.add(peak.offsetMs);
    }
  }
  const centers = [...centersSet].sort((a, b) => a - b);

  // Coarse search around each center, then 25ms refinement around top candidates
  const coarseSet = new Set<number>();
  for (const center of centers) {
    for (
      let off = center - 4_000;
      off <= center + 4_000;
      off += SEARCH_STEP_MS
    ) {
      if (Math.abs(off) <= MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS) {
        coarseSet.add(off);
      }
    }
    coarseSet.add(center);
  }
  if (coarseSet.size === 0) coarseSet.add(0);

  const rankedCoarse = [...coarseSet]
    .map((off) => ({
      offsetMs: off,
      score: evaluateOffset(
        cues,
        speechIntervals,
        off,
        audioStartMs,
        audioEndMs,
      ).score,
      dist: Math.min(...centers.map((c) => Math.abs(off - c))),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.dist !== b.dist) return a.dist - b.dist;
      return Math.abs(a.offsetMs) - Math.abs(b.offsetMs);
    });

  const topCoarse = rankedCoarse.slice(0, 6).map((item) => item.offsetMs);
  for (const peak of fftPeaks) {
    if (peak.confidence >= 15) topCoarse.push(peak.offsetMs);
  }

  const refinedSet = new Set<number>();
  for (const coarseOff of topCoarse) {
    for (
      let off = coarseOff - REFINE_RANGE_MS;
      off <= coarseOff + REFINE_RANGE_MS;
      off += REFINE_STEP_MS
    ) {
      if (Math.abs(off) <= MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS) {
        refinedSet.add(off);
      }
    }
  }

  let bestOffset = 0;
  let bestScore = -1;
  let bestDist = Infinity;

  for (const off of refinedSet) {
    const sc = evaluateOffset(
      cues,
      speechIntervals,
      off,
      audioStartMs,
      audioEndMs,
    ).score;
    const dist = Math.min(...centers.map((c) => Math.abs(off - c)));
    if (
      sc > bestScore ||
      (sc === bestScore && dist < bestDist) ||
      (sc === bestScore &&
        dist === bestDist &&
        Math.abs(off) < Math.abs(bestOffset))
    ) {
      bestScore = sc;
      bestOffset = off;
      bestDist = dist;
    }
  }

  return { offsetMs: bestOffset, score: Math.max(0, bestScore) };
}

export function evaluateSpeechWindowLocal(options: {
  cues: SubtitleCue[];
  speechIntervals: Array<[number, number]>;
  audioStartMs: number;
  audioEndMs: number;
  additionalHints?: number[];
}): LocalAlignmentResult {
  const { cues, speechIntervals, audioStartMs, audioEndMs } = options;
  const formattedSpeech = speechIntervals.map(([startMs, endMs]) => ({
    startMs,
    endMs,
  }));

  if (speechIntervals.length === 0) {
    return {
      aligned: false,
      offsetMs: 0,
      confidence: 0,
      speechIntervals: [],
      reason: "no_speech_detected",
    };
  }

  const totalSpeechMs = speechIntervals.reduce(
    (sum, [s, e]) => sum + Math.max(0, e - s),
    0,
  );
  if (totalSpeechMs < MIN_ALIGNMENT_SPEECH_DURATION_MS) {
    return {
      aligned: false,
      offsetMs: 0,
      confidence: 0,
      speechIntervals: formattedSpeech,
      reason: "insufficient_speech_in_window",
    };
  }

  if (cues.length === 0) {
    return {
      aligned: false,
      offsetMs: 0,
      confidence: 0,
      speechIntervals: formattedSpeech,
      reason: "invalid_subtitle",
    };
  }

  const cueIntervals: Array<[number, number]> = cues.map((c) => [
    c.startMs,
    c.endMs,
  ]);
  const fftHints = [...(options.additionalHints ?? [])];
  for (const peak of findTopOffsetsFft(
    speechIntervals,
    cueIntervals,
    audioStartMs,
    audioEndMs,
    MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS,
    false,
    null,
    3,
  )) {
    if (peak.confidence >= 35) {
      fftHints.push(peak.offsetMs);
    }
  }

  const searchCenters = computeTrackSearchCenters(
    cues,
    speechIntervals,
    fftHints,
  );
  const maxAllowedOffset = searchCenters.some(
    (c) => Math.abs(c) > MAX_ALIGNMENT_OFFSET_MS,
  )
    ? MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS
    : MAX_ALIGNMENT_OFFSET_MS;

  const { offsetMs, score } = findBestOffsetLocal(
    cues,
    speechIntervals,
    audioStartMs,
    audioEndMs,
    searchCenters,
  );
  const confidence = Math.round(Math.max(0, Math.min(1, score)) * 100);

  if (Math.abs(offsetMs) >= maxAllowedOffset) {
    return {
      aligned: false,
      offsetMs: 0,
      confidence,
      speechIntervals: formattedSpeech,
      reason: "offset_out_of_range",
    };
  }

  if (confidence < MIN_ALIGNMENT_CONFIDENCE) {
    return {
      aligned: false,
      offsetMs: 0,
      confidence,
      speechIntervals: formattedSpeech,
      reason: "low_alignment_confidence",
    };
  }

  const evidence = evaluateOffset(
    cues,
    speechIntervals,
    offsetMs,
    audioStartMs,
    audioEndMs,
  );
  const minimumAnchors = evidence.speechAnchorCount <= 1 ? 1 : 2;
  if (evidence.matchedAnchors < minimumAnchors) {
    return {
      aligned: false,
      offsetMs: 0,
      confidence,
      speechIntervals: formattedSpeech,
      speechAnchorCount: evidence.matchedAnchors,
      speechAnchorCoverage: evidence.anchorCoverage,
      reason: "insufficient_speech_anchors",
    };
  }

  if (evidence.matchedAnchors === 1 && confidence < 80) {
    return {
      aligned: false,
      offsetMs: 0,
      confidence,
      speechIntervals: formattedSpeech,
      speechAnchorCount: evidence.matchedAnchors,
      speechAnchorCoverage: evidence.anchorCoverage,
      reason: "low_confidence_for_single_anchor",
    };
  }

  const minCoverage =
    evidence.matchedAnchors >= 3
      ? MIN_SPEECH_ANCHOR_COVERAGE
      : MIN_SPEECH_ANCHOR_COVERAGE_2_ANCHORS;
  if (evidence.anchorCoverage < minCoverage) {
    return {
      aligned: false,
      offsetMs: 0,
      confidence,
      speechIntervals: formattedSpeech,
      speechAnchorCount: evidence.matchedAnchors,
      speechAnchorCoverage: evidence.anchorCoverage,
      reason: "insufficient_speech_anchors",
    };
  }

  return {
    aligned: true,
    offsetMs,
    confidence,
    speechIntervals: formattedSpeech,
    speechAnchorCount: evidence.matchedAnchors,
    speechAnchorCoverage: evidence.anchorCoverage,
    framerateRatio: 1.0,
    reason: null,
  };
}

/**
 * Align subtitle cues with captured audio window 100% on-device.
 */
export async function alignSingleWindowLocal(options: {
  audioWav: Uint8Array;
  vttData: string;
  audioStartMs: number;
}): Promise<LocalAlignmentResult> {
  const { samples, sampleRate, durationMs } = decodeWav(options.audioWav);
  const audioEndMs = options.audioStartMs + durationMs;

  const speechIntervals = await detectSpeechIntervals(
    samples,
    sampleRate,
    options.audioStartMs,
  );

  console.info(
    `[local-sync] Window start: ${options.audioStartMs}ms, duration: ${durationMs}ms, sampleRate: ${sampleRate}Hz, speech intervals: ${speechIntervals.length}`,
  );

  const cues = filterAlignmentCues(parseVttCues(options.vttData));
  const res = evaluateSpeechWindowLocal({
    cues,
    speechIntervals,
    audioStartMs: options.audioStartMs,
    audioEndMs,
  });

  console.info(
    `[local-sync] Window result -> offset: ${res.offsetMs}ms, confidence: ${res.confidence}%, anchors: ${res.speechAnchorCount ?? 0}, aligned: ${res.aligned}, reason: ${res.reason}`,
  );

  return res;
}

interface CandidateCluster {
  candidates: Array<{ startAt: number; result: LocalAlignmentResult }>;
  averageConfidence: number;
  averageOffsetMs: number;
  score: number;
}

function clusterAlignmentCandidates(
  candidates: Array<{ startAt: number; result: LocalAlignmentResult }>,
): CandidateCluster[] {
  const sorted = [...candidates].sort(
    (a, b) => a.result.offsetMs - b.result.offsetMs,
  );
  const rawClusters: Array<
    Array<{ startAt: number; result: LocalAlignmentResult }>
  > = [];

  for (const cand of sorted) {
    const current = rawClusters[rawClusters.length - 1];
    if (
      current &&
      cand.result.offsetMs - current[0]!.result.offsetMs <= 1_200
    ) {
      current.push(cand);
    } else {
      rawClusters.push([cand]);
    }
  }

  return rawClusters
    .map((clusterCandidates) => {
      const averageConfidence =
        clusterCandidates.reduce((s, c) => s + c.result.confidence, 0) /
        clusterCandidates.length;
      const averageOffsetMs =
        clusterCandidates.reduce((s, c) => s + c.result.offsetMs, 0) /
        clusterCandidates.length;
      const score = clusterCandidates.length * 100 + averageConfidence;
      return {
        candidates: clusterCandidates,
        averageConfidence,
        averageOffsetMs,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function selectAlignmentConsensusLocal(
  entries: Array<{ startAt: number; result: LocalAlignmentResult }>,
  allSpeechIntervals: Array<{ startMs: number; endMs: number }>,
): LocalAlignmentResult {
  const validEntries = entries.filter(
    (e) =>
      e.result.aligned &&
      e.result.confidence >= MIN_ALIGNMENT_CONFIDENCE &&
      Math.abs(e.result.offsetMs) <= MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS &&
      e.result.speechIntervals.length > 0,
  );

  if (validEntries.length === 0) {
    const bestConf = entries.reduce(
      (m, e) => Math.max(m, e.result.confidence),
      0,
    );
    return {
      aligned: false,
      offsetMs: 0,
      confidence: bestConf,
      speechIntervals: allSpeechIntervals,
      reason:
        allSpeechIntervals.length === 0
          ? "no_speech_detected"
          : "low_alignment_confidence",
    };
  }

  const clusters = clusterAlignmentCandidates(validEntries);
  const bestCluster = clusters[0]!;
  const secondCluster = clusters[1] ?? null;
  const scoreMargin = secondCluster
    ? bestCluster.score - secondCluster.score
    : Number.POSITIVE_INFINITY;

  const introEntry = validEntries.find((e) => e.startAt <= 120);
  const mainEntries = validEntries.filter((e) => e.startAt > 120);
  if (
    introEntry &&
    mainEntries.length > 0 &&
    introEntry.result.confidence >= 75 &&
    !mainEntries.some(
      (m) => Math.abs(introEntry.result.offsetMs - m.result.offsetMs) <= 1_200,
    )
  ) {
    const mainClusters = clusterAlignmentCandidates(mainEntries);
    const mainBest = mainClusters[0];
    if (
      mainBest &&
      mainBest.averageConfidence >= MIN_ALIGNMENT_CONFIDENCE &&
      Math.abs(introEntry.result.offsetMs - mainBest.averageOffsetMs) > 15_000
    ) {
      const introOffset = introEntry.result.offsetMs;
      const mainOffset = Math.round(mainBest.averageOffsetMs);
      return {
        ...introEntry.result,
        aligned: true,
        offsetMs: mainOffset,
        confidence: Math.round(
          (introEntry.result.confidence + mainBest.averageConfidence) / 2,
        ),
        speechIntervals: allSpeechIntervals,
        segments: [
          { startMs: 0, endMs: 180_000, offsetMs: introOffset },
          {
            startMs: 180_000,
            endMs: Number.MAX_SAFE_INTEGER,
            offsetMs: mainOffset,
          },
        ],
        reason: null,
      };
    }
  }

  let hasConsensus =
    bestCluster.candidates.length >= 2 &&
    bestCluster.averageConfidence >= MIN_ALIGNMENT_CONFIDENCE &&
    scoreMargin >= 10;

  if (!hasConsensus && bestCluster.candidates.length === 1) {
    if (bestCluster.averageConfidence >= 85 && scoreMargin >= 20) {
      hasConsensus = true;
    }
  }

  if (!hasConsensus) {
    return {
      aligned: false,
      offsetMs: 0,
      confidence: Math.round(bestCluster.averageConfidence),
      speechIntervals: allSpeechIntervals,
      reason:
        bestCluster.candidates.length < 2
          ? "insufficient_consensus"
          : "ambiguous_alignment",
    };
  }

  const avgOffset = Math.round(bestCluster.averageOffsetMs);
  const avgConf = Math.round(bestCluster.averageConfidence);
  const windowSyncEntries: WindowSyncEntry[] = validEntries.map((e) => ({
    startAt: e.startAt,
    result: {
      aligned: true,
      offsetMs: e.result.offsetMs,
      confidence: e.result.confidence,
    },
  }));
  const piecewiseSegments = computePiecewiseSegments(
    windowSyncEntries,
    avgOffset,
  );

  return {
    aligned: true,
    offsetMs: avgOffset,
    confidence: avgConf,
    speechIntervals: allSpeechIntervals,
    segments: piecewiseSegments.length > 0 ? piecewiseSegments : undefined,
    reason: null,
  };
}

/**
 * Align multiple windows on-device with consensus clustering, cross-window
 * rescue, and pooled multi-window fallback.
 */
export async function alignWindowsLocal(options: {
  windows: Array<{ audioWav: Uint8Array; startMs: number }>;
  vttData: string;
}): Promise<LocalAlignmentResult> {
  const cues = filterAlignmentCues(parseVttCues(options.vttData));
  const windowData: Array<{
    startMs: number;
    endMs: number;
    speechIntervals: Array<[number, number]>;
    result: LocalAlignmentResult;
  }> = [];
  let allSpeechIntervals: Array<{ startMs: number; endMs: number }> = [];

  for (const win of options.windows) {
    const { samples, sampleRate, durationMs } = decodeWav(win.audioWav);
    const audioEndMs = win.startMs + durationMs;
    const speechIntervals = await detectSpeechIntervals(
      samples,
      sampleRate,
      win.startMs,
    );
    const res = evaluateSpeechWindowLocal({
      cues,
      speechIntervals,
      audioStartMs: win.startMs,
      audioEndMs,
    });
    windowData.push({
      startMs: win.startMs,
      endMs: audioEndMs,
      speechIntervals,
      result: res,
    });
    allSpeechIntervals = allSpeechIntervals.concat(res.speechIntervals);
  }

  let entries = windowData.map((w) => ({
    startAt: w.startMs / 1000,
    result: w.result,
  }));
  let consensus = selectAlignmentConsensusLocal(entries, allSpeechIntervals);

  // Cross-window rescue if some windows aligned and others failed
  if (!consensus.aligned && cues.length > 0 && windowData.length >= 2) {
    const alignedHints = windowData
      .filter((w) => w.result.aligned)
      .map((w) => w.result.offsetMs);

    if (alignedHints.length > 0) {
      entries = windowData.map((w) => {
        if (w.result.aligned) {
          return { startAt: w.startMs / 1000, result: w.result };
        }
        const rescued = evaluateSpeechWindowLocal({
          cues,
          speechIntervals: w.speechIntervals,
          audioStartMs: w.startMs,
          audioEndMs: w.endMs,
          additionalHints: alignedHints,
        });
        return {
          startAt: w.startMs / 1000,
          result: rescued.aligned ? rescued : w.result,
        };
      });
      consensus = selectAlignmentConsensusLocal(entries, allSpeechIntervals);
    }

    // Pooled multi-window fallback for sparse-dialogue movies
    if (!consensus.aligned) {
      const pooledSpeech = mergeActivityIntervals(
        windowData.flatMap((w) => w.speechIntervals),
        350,
      );
      if (pooledSpeech.length >= 2) {
        const minStartMs = Math.min(...windowData.map((w) => w.startMs));
        const maxEndMs = Math.max(...windowData.map((w) => w.endMs));
        const pooledRes = evaluateSpeechWindowLocal({
          cues,
          speechIntervals: pooledSpeech,
          audioStartMs: minStartMs,
          audioEndMs: maxEndMs,
          additionalHints: alignedHints,
        });
        if (
          pooledRes.aligned &&
          (pooledRes.speechAnchorCount ?? 0) >= 2 &&
          pooledRes.confidence >= 65
        ) {
          consensus = {
            ...pooledRes,
            speechIntervals: allSpeechIntervals,
          };
        }
      }
    }
  }

  console.info(
    `[local-sync] Consensus alignment complete -> aligned: ${consensus.aligned}, offset: ${consensus.offsetMs}ms, confidence: ${consensus.confidence}%, segments: ${consensus.segments?.length ?? 0}, reason: ${consensus.reason}`,
  );

  return consensus;
}
