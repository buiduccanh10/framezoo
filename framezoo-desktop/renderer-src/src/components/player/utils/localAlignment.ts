import type {
  MoonshineAlignmentInterval,
  MoonshineAlignmentResult,
} from "@/moonshine/types";

const MIN_ALIGNMENT_CONFIDENCE = 60;
const MIN_ALIGNMENT_SPEECH_DURATION_MS = 1_000;
const MAX_ALIGNMENT_OFFSET_MS = 45_000;
const MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS = 180_000;
const SEARCH_RANGE_MS = 45_000;
const SEARCH_STEP_MS = 250;
const REFINE_RANGE_MS = 750;
const REFINE_STEP_MS = 25;
const SUBTITLE_ACTIVITY_MERGE_GAP_MS = 250;
const MAX_SPEECH_ANCHOR_ERROR_MS = 1_800;
const MIN_SPEECH_ANCHOR_OVERLAP_MS = 120;
const MIN_SPEECH_ANCHOR_COVERAGE = 0.2;
const MIN_SPEECH_ANCHOR_COVERAGE_2_ANCHORS = 0.25;

const TIMING_LINE_RE =
  /^\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{3})?)\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{3})?)(?:\s+.*)?$/;
const CREDIT_AD_RE =
  /https?:\/\/|www\.|osdb\.link|\.org\b|\.com\b|\.net\b|\.link\b|\.tv\b|\.me\b|opensubtitles|subscene|addic7ed|podnapisi|yify|rarbg|psa\b|vip\s*member|remove\s*all\s*ads|watch\s*online|support\s*us|subtitles?\s*(by|downloaded|created|sync)|synced?\s*by|resync\s*by|corrected\s*by|dịch\s*bởi|biên\s*dịch|thực\s*hiện\s*bởi|vietsub\s*bởi|phimmoi|xemphim|motphim|bilutv|tvhay/i;

type Cue = { startMs: number; endMs: number; block: string };
type Interval = [number, number];

function parseTimestamp(value: string) {
  const parts = value.replace(",", ".").split(":");
  const secondsPart = parts.pop() ?? "0";
  const [seconds, milliseconds] = secondsPart.split(".");
  const minute = parts.length > 0 ? Number(parts.pop()) : 0;
  const hour = parts.length > 0 ? Number(parts.pop()) : 0;
  return (
    hour * 3_600_000 +
    minute * 60_000 +
    Number(seconds) * 1_000 +
    Number((milliseconds ?? "0").padEnd(3, "0").slice(0, 3))
  );
}

function parseCues(vtt: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of vtt.trim().split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const timingIndex = lines.findIndex((line) => TIMING_LINE_RE.test(line));
    if (timingIndex < 0) continue;

    const match = TIMING_LINE_RE.exec(lines[timingIndex]!);
    if (!match) continue;

    const startMs = parseTimestamp(match[1]!);
    const endMs = parseTimestamp(match[2]!);
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs <= startMs
    ) {
      continue;
    }
    cues.push({ startMs, endMs, block });
  }
  return cues;
}

function isCreditOrAdCue(cue: Cue) {
  return CREDIT_AD_RE.test(cue.block);
}

function mergeIntervals(
  intervals: Interval[],
  maxGapMs: number,
  minimumDurationMs = 0,
): Interval[] {
  const merged: Interval[] = [];
  for (const [startMs, endMs] of [...intervals].sort(
    ([first], [second]) => first - second,
  )) {
    if (endMs - startMs < minimumDurationMs) continue;
    const previous = merged[merged.length - 1];
    if (previous && startMs <= previous[1] + maxGapMs) {
      previous[1] = Math.max(previous[1], endMs);
    } else {
      merged.push([startMs, endMs]);
    }
  }
  return merged;
}

function normalizeSpeechIntervals(intervals: Interval[]) {
  return mergeIntervals(intervals, 350, 120);
}

function clipIntervals(
  intervals: Interval[],
  startMs: number,
  endMs: number,
): Interval[] {
  return intervals
    .map(
      ([intervalStart, intervalEnd]) =>
        [
          Math.max(startMs, intervalStart),
          Math.min(endMs, intervalEnd),
        ] as Interval,
    )
    .filter(([start, end]) => end > start);
}

function overlapMs(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
) {
  return Math.max(
    0,
    Math.min(firstEnd, secondEnd) - Math.max(firstStart, secondStart),
  );
}

function totalOverlap(first: Interval[], second: Interval[]) {
  let total = 0;
  let secondIndex = 0;
  for (const [firstStart, firstEnd] of first) {
    while (
      secondIndex < second.length &&
      second[secondIndex]![1] <= firstStart
    ) {
      secondIndex += 1;
    }
    for (let index = secondIndex; index < second.length; index += 1) {
      const [secondStart, secondEnd] = second[index]!;
      if (secondStart >= firstEnd) break;
      total += overlapMs(firstStart, firstEnd, secondStart, secondEnd);
    }
  }
  return total;
}

function buildSubtitleIntervals(
  cues: Cue[],
  offsetMs: number,
  audioStartMs: number,
  audioEndMs: number,
) {
  return mergeIntervals(
    clipIntervals(
      cues.map(
        (cue) => [cue.startMs + offsetMs, cue.endMs + offsetMs] as Interval,
      ),
      audioStartMs,
      audioEndMs,
    ),
    SUBTITLE_ACTIVITY_MERGE_GAP_MS,
  );
}

function matchAnchors(speech: Interval[], subtitles: Interval[]) {
  const used = new Set<number>();
  const errors: number[] = [];
  let lastSubtitleIndex = -1;

  for (const [speechStart, speechEnd] of speech) {
    let bestIndex = -1;
    let bestRank: [number, number] | null = null;
    const speechDuration = speechEnd - speechStart;

    for (let index = 0; index < subtitles.length; index += 1) {
      if (used.has(index) || index <= lastSubtitleIndex) continue;
      const [subtitleStart, subtitleEnd] = subtitles[index]!;
      const overlap = overlapMs(
        speechStart,
        speechEnd,
        subtitleStart,
        subtitleEnd,
      );
      if (overlap < MIN_SPEECH_ANCHOR_OVERLAP_MS) continue;
      const boundaryError = Math.min(
        Math.abs(speechStart - subtitleStart),
        Math.abs(speechEnd - subtitleEnd),
      );
      const overlapRatio =
        overlap /
        Math.max(
          MIN_SPEECH_ANCHOR_OVERLAP_MS,
          Math.min(speechDuration, subtitleEnd - subtitleStart),
        );
      if (boundaryError > MAX_SPEECH_ANCHOR_ERROR_MS && overlapRatio < 0.25) {
        continue;
      }
      const rank: [number, number] = [overlapRatio, -boundaryError];
      if (
        !bestRank ||
        rank[0] > bestRank[0] ||
        (rank[0] === bestRank[0] && rank[1] > bestRank[1])
      ) {
        bestIndex = index;
        bestRank = rank;
      }
    }

    if (bestIndex < 0) continue;
    used.add(bestIndex);
    lastSubtitleIndex = bestIndex;
    const [subtitleStart, subtitleEnd] = subtitles[bestIndex]!;
    errors.push(
      Math.min(
        Math.abs(speechStart - subtitleStart),
        Math.abs(speechEnd - subtitleEnd),
      ),
    );
  }
  return { count: errors.length, errors };
}

function evaluateOffset(
  cues: Cue[],
  speechIntervals: Interval[],
  offsetMs: number,
  audioStartMs: number,
  audioEndMs: number,
) {
  const speech = clipIntervals(speechIntervals, audioStartMs, audioEndMs);
  const subtitles = buildSubtitleIntervals(
    cues,
    offsetMs,
    audioStartMs,
    audioEndMs,
  );
  if (!speech.length || !subtitles.length) {
    return {
      score: 0,
      matchedAnchors: 0,
      speechAnchorCount: speech.length,
      anchorCoverage: 0,
      medianAnchorErrorMs: 0,
    };
  }

  const speechDuration = speech.reduce(
    (sum, [start, end]) => sum + end - start,
    0,
  );
  const subtitleDuration = subtitles.reduce(
    (sum, [start, end]) => sum + end - start,
    0,
  );
  const overlapDuration = totalOverlap(speech, subtitles);
  const unionDuration = speechDuration + subtitleDuration - overlapDuration;
  if (speechDuration <= 0 || subtitleDuration <= 0 || unionDuration <= 0) {
    return {
      score: 0,
      matchedAnchors: 0,
      speechAnchorCount: speech.length,
      anchorCoverage: 0,
      medianAnchorErrorMs: 0,
    };
  }

  const anchors = matchAnchors(speech, subtitles);
  const anchorCoverage = anchors.count / speech.length;
  const sortedErrors = [...anchors.errors].sort((a, b) => a - b);
  const medianAnchorErrorMs =
    sortedErrors.length > 0
      ? sortedErrors[Math.floor(sortedErrors.length / 2)]!
      : MAX_SPEECH_ANCHOR_ERROR_MS;
  const speechRecall = overlapDuration / speechDuration;
  const subtitlePrecision = overlapDuration / subtitleDuration;
  const activityIou = overlapDuration / unionDuration;
  const boundaryScore = Math.max(
    0,
    1 - medianAnchorErrorMs / MAX_SPEECH_ANCHOR_ERROR_MS,
  );
  let score =
    activityIou * 0.3 +
    speechRecall * 0.2 +
    subtitlePrecision * 0.15 +
    anchorCoverage * 0.25 +
    boundaryScore * 0.1;
  if (anchors.count === 0) score *= 0.5;
  return {
    score: Math.min(1, score),
    matchedAnchors: anchors.count,
    speechAnchorCount: speech.length,
    anchorCoverage,
    medianAnchorErrorMs,
  };
}

function estimateInitialCueStart(cues: Cue[]) {
  const dialogueCues = cues.filter((cue) => !isCreditOrAdCue(cue));
  const candidatesSource = dialogueCues.length > 0 ? dialogueCues : cues;
  const candidates = candidatesSource.slice(
    0,
    Math.min(10, candidatesSource.length),
  );
  const cue = candidates.find((item) => item.endMs - item.startMs >= 800);
  return (
    cue?.startMs ??
    candidates[0]?.startMs ??
    dialogueCues[0]?.startMs ??
    cues[0]?.startMs ??
    null
  );
}

function estimateRelativeOffset(primary: Cue[], secondary: Cue[]) {
  if (!primary.length || !secondary.length) return null;
  const cleanPrimary = primary.filter((cue) => !isCreditOrAdCue(cue));
  const cleanSecondary = secondary.filter((cue) => !isCreditOrAdCue(cue));
  const relativePrimary = cleanPrimary.length > 0 ? cleanPrimary : primary;
  const relativeSecondary =
    cleanSecondary.length > 0 ? cleanSecondary : secondary;
  const selectRelativeCues = (cues: Cue[]) => {
    const firstThirtyMinutes = cues.filter((cue) => cue.startMs <= 1_800_000);
    return (
      firstThirtyMinutes.length < 5 ? cues.slice(0, 100) : firstThirtyMinutes
    ).filter((cue) => cue.endMs > cue.startMs);
  };
  const p = selectRelativeCues(relativePrimary);
  const s = selectRelativeCues(relativeSecondary);
  const pIntervals = mergeIntervals(
    p.map((cue) => [cue.startMs, cue.endMs] as Interval),
    250,
  );
  const sIntervals = mergeIntervals(
    s.map((cue) => [cue.startMs, cue.endMs] as Interval),
    250,
  );
  const pStart = estimateInitialCueStart(relativePrimary);
  const sStart = estimateInitialCueStart(relativeSecondary);
  const initialDiff = pStart !== null && sStart !== null ? pStart - sStart : 0;
  if (!pIntervals.length || !sIntervals.length) {
    return pStart !== null && sStart !== null ? initialDiff : null;
  }
  const pDuration = pIntervals.reduce(
    (sum, [start, end]) => sum + end - start,
    0,
  );
  const rank = (offset: number): [number, number] => [
    totalOverlap(
      pIntervals,
      sIntervals.map(([start, end]) => [start + offset, end + offset]),
    ) / pDuration,
    -Math.abs(offset - initialDiff),
  ];
  const candidates = new Set<number>();
  for (const center of [0, initialDiff]) {
    for (
      let offset = center - 45_000;
      offset <= center + 45_000;
      offset += 500
    ) {
      if (Math.abs(offset) <= MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS)
        candidates.add(offset);
    }
  }
  const bestCoarse =
    [...candidates].sort((a, b) => {
      const first = rank(a);
      const second = rank(b);
      return second[0] - first[0] || second[1] - first[1];
    })[0] ?? 0;
  let best = bestCoarse;
  for (
    let offset = bestCoarse - 1_000;
    offset <= bestCoarse + 1_000;
    offset += 50
  ) {
    const current = rank(offset);
    const selected = rank(best);
    if (
      current[0] > selected[0] ||
      (current[0] === selected[0] && current[1] > selected[1])
    ) {
      best = offset;
    }
  }
  return rank(best)[0] > 0.15
    ? best
    : pStart !== null && sStart !== null
      ? initialDiff
      : null;
}

function computeSearchCenters(
  cues: Cue[],
  speech: Interval[],
  audioStartMs: number,
  hints: number[] = [],
) {
  const centers = new Set<number>([0, ...hints]);
  if (cues.length && speech.length && audioStartMs <= 60_000) {
    const firstCue = estimateInitialCueStart(cues);
    if (firstCue !== null) {
      const guided = speech[0]![0] - firstCue;
      if (Math.abs(guided) <= MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS) {
        centers.add(guided);
      }
    }
  }
  return [...centers].filter(
    (center) => Math.abs(center) <= MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS,
  );
}

function findBestOffset(
  cues: Cue[],
  speech: Interval[],
  audioStartMs: number,
  audioEndMs: number,
  centers: number[],
) {
  const rank = (offset: number): [number, number] => {
    const evidence = evaluateOffset(
      cues,
      speech,
      offset,
      audioStartMs,
      audioEndMs,
    );
    return [
      evidence.score,
      -Math.min(...centers.map((center) => Math.abs(offset - center))),
    ];
  };
  const candidates = new Set<number>();
  for (const center of centers) {
    for (
      let offset = center - SEARCH_RANGE_MS;
      offset <= center + SEARCH_RANGE_MS;
      offset += SEARCH_STEP_MS
    ) {
      if (Math.abs(offset) <= MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS) {
        candidates.add(offset);
      }
    }
  }
  let coarse = [...candidates][0] ?? 0;
  for (const candidate of candidates) {
    const current = rank(candidate);
    const selected = rank(coarse);
    if (
      current[0] > selected[0] ||
      (current[0] === selected[0] && current[1] > selected[1])
    ) {
      coarse = candidate;
    }
  }
  let best = coarse;
  for (
    let offset = coarse - REFINE_RANGE_MS;
    offset <= coarse + REFINE_RANGE_MS;
    offset += REFINE_STEP_MS
  ) {
    const current = rank(offset);
    const selected = rank(best);
    if (
      current[0] > selected[0] ||
      (current[0] === selected[0] && current[1] > selected[1])
    ) {
      best = offset;
    }
  }
  return { offsetMs: best, score: rank(best)[0] };
}

function asSpeechIntervals(
  intervals: Interval[],
): MoonshineAlignmentInterval[] {
  return intervals.map(([startMs, endMs]) => ({ startMs, endMs }));
}

function invalidResult(
  speech: Interval[],
  reason: string,
): MoonshineAlignmentResult {
  return {
    aligned: false,
    offsetMs: 0,
    confidence: 0,
    speechIntervals: asSpeechIntervals(speech),
    reason,
  };
}

export function alignLocalTrack(
  vttData: string,
  speechIntervals: Interval[],
  audioStartMs: number,
  audioEndMs: number,
  extraHints: number[] = [],
): MoonshineAlignmentResult {
  if (!speechIntervals.length) {
    return invalidResult([], "no_speech_detected");
  }
  if (
    speechIntervals.reduce(
      (sum, [start, end]) => sum + Math.max(0, end - start),
      0,
    ) < MIN_ALIGNMENT_SPEECH_DURATION_MS
  ) {
    return invalidResult(speechIntervals, "insufficient_speech_in_window");
  }
  const cues = parseCues(vttData);
  if (!cues.length) return invalidResult(speechIntervals, "invalid_subtitle");

  const centers = computeSearchCenters(
    cues,
    speechIntervals,
    audioStartMs,
    extraHints,
  );
  const maxAllowedOffset = centers.some(
    (center) => Math.abs(center) > MAX_ALIGNMENT_OFFSET_MS,
  )
    ? MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS
    : MAX_ALIGNMENT_OFFSET_MS;
  const { offsetMs, score } = findBestOffset(
    cues,
    speechIntervals,
    audioStartMs,
    audioEndMs,
    centers,
  );
  const confidence = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const base = {
    aligned: false,
    offsetMs: 0,
    confidence,
    speechIntervals: asSpeechIntervals(speechIntervals),
  };
  if (Math.abs(offsetMs) >= maxAllowedOffset) {
    return { ...base, reason: "offset_out_of_range" };
  }
  if (confidence < MIN_ALIGNMENT_CONFIDENCE) {
    return { ...base, reason: "low_alignment_confidence" };
  }
  const evidence = evaluateOffset(
    cues,
    speechIntervals,
    offsetMs,
    audioStartMs,
    audioEndMs,
  );
  const minimumAnchors = evidence.speechAnchorCount <= 1 ? 1 : 2;
  const anchorBase = {
    speechAnchorCount: evidence.matchedAnchors,
    speechAnchorCoverage: evidence.anchorCoverage,
  };
  if (
    evidence.matchedAnchors < minimumAnchors ||
    evidence.anchorCoverage <
      (evidence.matchedAnchors >= 3
        ? MIN_SPEECH_ANCHOR_COVERAGE
        : MIN_SPEECH_ANCHOR_COVERAGE_2_ANCHORS)
  ) {
    return { ...base, ...anchorBase, reason: "insufficient_speech_anchors" };
  }
  return {
    ...base,
    aligned: true,
    offsetMs,
    ...anchorBase,
    reason: null,
  };
}

export function alignLocalBatch(
  subtitles: Array<{ track: "primary" | "secondary"; vttData: string }>,
  speechIntervals: Interval[],
  audioStartMs: number,
  audioEndMs: number,
) {
  const normalizedSpeechIntervals = normalizeSpeechIntervals(speechIntervals);
  const parsed = new Map(
    subtitles.map((subtitle) => [subtitle.track, parseCues(subtitle.vttData)]),
  );
  const deltaHint = estimateRelativeOffset(
    parsed.get("primary") ?? [],
    parsed.get("secondary") ?? [],
  );
  const results: Partial<
    Record<"primary" | "secondary", MoonshineAlignmentResult>
  > = {};
  let primaryOffset: number | null = null;

  const orderedSubtitles = [
    ...subtitles.filter((subtitle) => subtitle.track === "primary"),
    ...subtitles.filter((subtitle) => subtitle.track !== "primary"),
  ];

  for (const subtitle of orderedSubtitles) {
    const hints: number[] = [];
    if (subtitle.track === "primary" && deltaHint !== null) {
      hints.push(-deltaHint);
    } else if (subtitle.track !== "primary" && deltaHint !== null) {
      hints.push(deltaHint);
      if (primaryOffset !== null) hints.push(primaryOffset + deltaHint);
    }
    const result = alignLocalTrack(
      subtitle.vttData,
      normalizedSpeechIntervals,
      audioStartMs,
      audioEndMs,
      hints,
    );
    results[subtitle.track] = result;
    if (subtitle.track === "primary" && result.aligned) {
      primaryOffset = result.offsetMs;
    }
  }
  return { results };
}
