import DOMPurify from "dompurify";
import { convert, detect, parse } from "subsrt-ts";
import { ContentCaption } from "subsrt-ts/dist/types/handler";

export type CaptionCueType = ContentCaption;
export const sanitize = DOMPurify.sanitize;

const CAPTION_HTML_OPTIONS = {
  ALLOWED_TAGS: ["c", "b", "i", "u", "span", "ruby", "rt", "br"],
  ADD_TAGS: ["v", "lang"],
  ALLOWED_ATTR: ["title", "lang"],
};
const SUBTITLE_FORMATS = new Set([
  "sub",
  "srt",
  "sbv",
  "vtt",
  "lrc",
  "smi",
  "ssa",
  "ass",
  "json",
]);

export function captionHtml(content?: string): string {
  return sanitize(
    (content || "").replaceAll(/\r?\n/g, "<br />"),
    CAPTION_HTML_OPTIONS,
  );
}

export function captionPlainText(content?: string): string {
  return (content || "")
    .replaceAll(/<[^>]*>/g, "")
    .replaceAll(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function captionIsVisible(
  start: number,
  end: number,
  delay: number,
  currentTime: number,
) {
  const delayedStart = start / 1000 + delay;
  const delayedEnd = end / 1000 + delay;
  return (
    Math.max(0, delayedStart) <= currentTime &&
    Math.max(0, delayedEnd) > currentTime
  );
}

export function getCaptionTimelineIndex(
  cues: CaptionCueType[],
  delay: number,
  currentTime: number,
): number | null {
  if (cues.length === 0) return null;

  const visibleIndex = cues.findIndex(({ start, end }) =>
    captionIsVisible(start, end, delay, currentTime),
  );
  if (visibleIndex !== -1) return visibleIndex;

  const nextIndex = cues.findIndex(
    ({ start }) => start / 1000 + delay > currentTime,
  );
  return nextIndex === -1 ? cues.length - 1 : Math.max(0, nextIndex - 1);
}

export function getCaptionLookahead(
  cues: CaptionCueType[],
  delay: number,
  currentTime: number,
): {
  currentIndex: number | null;
  currentCue: CaptionCueType | null;
  nextIndex: number | null;
  nextCue: CaptionCueType | null;
} {
  const currentIndex = cues.findIndex(({ start, end }) =>
    captionIsVisible(start, end, delay, currentTime),
  );
  const nextIndex = cues.findIndex(
    ({ start }, index) =>
      index > currentIndex && start / 1000 + delay > currentTime,
  );

  return {
    currentIndex: currentIndex === -1 ? null : currentIndex,
    currentCue: currentIndex === -1 ? null : (cues[currentIndex] ?? null),
    nextIndex: nextIndex === -1 ? null : nextIndex,
    nextCue: nextIndex === -1 ? null : (cues[nextIndex] ?? null),
  };
}

export function getCaptionTimelineNavigationIndex(
  currentIndex: number | null,
  direction: -1 | 1,
  cueCount: number,
): number | null {
  if (currentIndex === null || cueCount === 0) return null;

  const nextIndex = currentIndex + direction;
  return nextIndex < 0 || nextIndex >= cueCount ? currentIndex : nextIndex;
}

export function getCaptionTimelineWindow(
  currentIndex: number | null,
  cueCount: number,
  radius = 6,
): { start: number; end: number } {
  if (currentIndex === null || cueCount === 0) {
    return { start: 0, end: 0 };
  }

  return {
    start: Math.max(0, currentIndex - radius),
    end: Math.min(cueCount, currentIndex + radius + 1),
  };
}

export function getCaptionCueForNavigation(
  cues: CaptionCueType[],
  delay: number,
  currentTime: number,
  direction: -1 | 1,
): CaptionCueType | null {
  const currentIndex = getCaptionTimelineIndex(cues, delay, currentTime);
  const nextIndex = getCaptionTimelineNavigationIndex(
    currentIndex,
    direction,
    cues.length,
  );

  if (nextIndex === null || nextIndex === currentIndex) return null;
  return cues[nextIndex] ?? null;
}

export function getCaptionDelayForCue(
  cue: CaptionCueType,
  currentTime: number,
): number {
  return currentTime - cue.start / 1000;
}

export function makeQueId(index: number, start: number, end: number): string {
  return `${index}-${start}-${end}`;
}

const VTT_TIMESTAMP_PATTERN = String.raw`(?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}`;
const VTT_HEADER_RE = /^\s*WEBVTT(?:[ \t].*)?(?:\r?\n|$)/i;
const VTT_TIMING_LINE_RE = new RegExp(
  String.raw`^\s*(${VTT_TIMESTAMP_PATTERN})\s+-->\s+(${VTT_TIMESTAMP_PATTERN})(.*)$`,
);
const VTT_CUE_TIMING_RE = new RegExp(VTT_TIMING_LINE_RE.source, "m");

function normalizeFormatHint(format?: string): string | undefined {
  const normalized = format?.trim().toLowerCase().replace(/^\./, "");
  return normalized && SUBTITLE_FORMATS.has(normalized)
    ? normalized
    : undefined;
}

function hasVttHeader(text: string): boolean {
  return VTT_HEADER_RE.test(text);
}

function hasVttCue(text: string): boolean {
  return VTT_CUE_TIMING_RE.test(text);
}

function getDetectedSubtitleFormat(text: string): string | undefined {
  if (hasVttHeader(text)) return "vtt";

  const detected = detect(text);
  if (detected) return detected;

  return hasVttCue(text) ? "vtt" : undefined;
}

function prepareVttInput(text: string): string {
  return hasVttHeader(text) ? text : `WEBVTT\n\n${text}`;
}

function isEmptyVttDocument(text: string): boolean {
  if (!hasVttHeader(text)) return false;

  const firstLineEnd = text.search(/\r?\n/);
  if (firstLineEnd === -1) return true;

  return (
    text.slice(firstLineEnd + (text[firstLineEnd] === "\r" ? 2 : 1)).trim() ===
    ""
  );
}

function getTimestampParts(ms: number) {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const remMs = total % 1000;
  return { hours, minutes, seconds, ms: remMs };
}

function buildTimestampMs(
  hours: number,
  minutes: number,
  seconds: number,
  ms: number,
): number {
  return hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + ms;
}

export function repairBrokenSrtTimeline(vttText: string): string {
  const normalizedText = vttText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawBlocks = normalizedText.split(/\n\s*\n/);

  type BlockInfo = {
    index: number;
    raw: string;
    hasTiming: boolean;
    startMs: number;
    endMs: number;
    match?: RegExpExecArray;
  };

  const parsedBlocks: BlockInfo[] = rawBlocks.map((block, index) => {
    const match = VTT_CUE_TIMING_RE.exec(block);
    if (!match) {
      return { index, raw: block, hasTiming: false, startMs: 0, endMs: 0 };
    }
    const startMs = parseVttTimestamp(match[1]);
    const endMs = parseVttTimestamp(match[2]);
    const hasTiming = Number.isFinite(startMs) && Number.isFinite(endMs);
    return {
      index,
      raw: block,
      hasTiming,
      startMs: hasTiming ? startMs : 0,
      endMs: hasTiming ? endMs : 0,
      match,
    };
  });

  const timedIndices = parsedBlocks
    .map((b, i) => (b.hasTiming ? i : -1))
    .filter((i) => i !== -1);

  let repairedCount = 0;
  let droppedCount = 0;

  for (let pass = 0; pass < 2; pass++) {
    for (let t = 0; t < timedIndices.length; t++) {
      const currIdx = timedIndices[t];
      const curr = parsedBlocks[currIdx];

      const prev = t > 0 ? parsedBlocks[timedIndices[t - 1]] : null;
      const next =
        t < timedIndices.length - 1 ? parsedBlocks[timedIndices[t + 1]] : null;

      const isStartGtEnd = curr.startMs > curr.endMs;

      // Lookahead window to detect forward spikes (jumping forward into future while later cues are in past)
      const futureIndices = timedIndices.slice(t + 1, t + 6);
      const earlierFutures = futureIndices.filter(
        (fIdx) => parsedBlocks[fIdx].startMs < curr.startMs - 2000,
      );
      const isForwardSpike =
        earlierFutures.length >= 2 ||
        (futureIndices.length > 0 &&
          earlierFutures.length === futureIndices.length);

      const isDurationUnreasonable = curr.endMs - curr.startMs > 60_000;

      if (isStartGtEnd || isForwardSpike || isDurationUnreasonable) {
        // Collect neighbor minutes to find consensus baseline minute
        const neighborMinutes: number[] = [];
        for (
          let k = Math.max(0, t - 4);
          k <= Math.min(timedIndices.length - 1, t + 5);
          k++
        ) {
          if (k !== t) {
            const neighborCue = parsedBlocks[timedIndices[k]];
            neighborMinutes.push(
              Math.floor((neighborCue.startMs % 3_600_000) / 60_000),
            );
          }
        }

        // Count frequency of minutes in neighborhood
        const minuteCounts = new Map<number, number>();
        let baselineMinute = 0;
        let maxCount = 0;
        for (const m of neighborMinutes) {
          const count = (minuteCounts.get(m) ?? 0) + 1;
          minuteCounts.set(m, count);
          if (count > maxCount) {
            maxCount = count;
            baselineMinute = m;
          }
        }

        const sp = getTimestampParts(curr.startMs);
        const ep = getTimestampParts(curr.endMs);
        const pp = prev ? getTimestampParts(prev.endMs) : null;
        const np = next ? getTimestampParts(next.startMs) : null;

        type Candidate = {
          name: string;
          startMs: number;
          endMs: number;
        };
        const candidates: Candidate[] = [];

        // 1. Candidate: Align both start and end to the neighborhood consensus baseline minute
        const cBaselineStart = buildTimestampMs(
          sp.hours,
          baselineMinute,
          sp.seconds,
          sp.ms,
        );
        const cBaselineEnd = buildTimestampMs(
          ep.hours,
          baselineMinute,
          ep.seconds,
          ep.ms,
        );
        if (
          cBaselineStart <= cBaselineEnd &&
          cBaselineEnd - cBaselineStart < 60_000
        ) {
          candidates.push({
            name: "baseline_both",
            startMs: cBaselineStart,
            endMs: cBaselineEnd,
          });
        }

        // 2. Candidate: Fix start minute to match end minute (e.g. 00:02:32 -> 00:00:32 when end is 00:00:34)
        const c1 = buildTimestampMs(sp.hours, ep.minutes, sp.seconds, sp.ms);
        if (c1 <= curr.endMs && curr.endMs - c1 < 60_000) {
          candidates.push({
            name: "fix_start_minute_to_end",
            startMs: c1,
            endMs: curr.endMs,
          });
        }

        // 3. Candidate: Fix start minute to match prev minute (e.g. 00:33:58 -> 00:32:58 when prev ends at 00:32:57)
        if (pp) {
          const c2 = buildTimestampMs(sp.hours, pp.minutes, sp.seconds, sp.ms);
          if (c2 <= curr.endMs && curr.endMs - c2 < 60_000) {
            candidates.push({
              name: "fix_start_minute_to_prev",
              startMs: c2,
              endMs: curr.endMs,
            });
          }
        }

        // 4. Candidate: Fix end minute to match start minute (e.g. 00:33:04 -> 00:03:07 => end becomes 00:33:07)
        const c3 = buildTimestampMs(ep.hours, sp.minutes, ep.seconds, ep.ms);
        if (curr.startMs <= c3 && c3 - curr.startMs < 60_000) {
          candidates.push({
            name: "fix_end_minute_to_start",
            startMs: curr.startMs,
            endMs: c3,
          });
        }

        // 5. Candidate: Fix end minute to match next minute (e.g. 00:15:35 -> 00:03:59 => end becomes 00:15:39)
        if (np) {
          const c4 = buildTimestampMs(ep.hours, np.minutes, ep.seconds, ep.ms);
          if (curr.startMs <= c4 && c4 - curr.startMs < 60_000) {
            candidates.push({
              name: "fix_end_minute_to_next",
              startMs: curr.startMs,
              endMs: c4,
            });
          }
        }

        // 6. Candidate: Zero out start minute (if surrounding context is minute 0)
        const c5 = buildTimestampMs(sp.hours, 0, sp.seconds, sp.ms);
        if (c5 <= curr.endMs && curr.endMs - c5 < 60_000) {
          candidates.push({
            name: "fix_start_minute_zero",
            startMs: c5,
            endMs: curr.endMs,
          });
        }

        // 7. Derive start from end if end is consistent with neighboring context
        if (
          candidates.length === 0 &&
          (prev !== null || next !== null) &&
          (!prev || curr.endMs >= prev.startMs) &&
          (!next || curr.endMs <= next.endMs + 30_000)
        ) {
          const fStart = Math.max(prev ? prev.endMs : 0, curr.endMs - 2500);
          if (fStart < curr.endMs) {
            candidates.push({
              name: "derive_start_from_end",
              startMs: fStart,
              endMs: curr.endMs,
            });
          }
        }

        // 8. Derive end from start if start is consistent with neighboring context
        if (
          candidates.length === 0 &&
          (prev !== null || next !== null) &&
          (!prev || curr.startMs >= prev.startMs - 30_000) &&
          (!next || curr.startMs <= next.startMs)
        ) {
          const fEnd = Math.min(
            next ? next.startMs : curr.startMs + 3000,
            curr.startMs + 2500,
          );
          if (curr.startMs < fEnd) {
            candidates.push({
              name: "derive_end_from_start",
              startMs: curr.startMs,
              endMs: fEnd,
            });
          }
        }

        let bestCandidate: Candidate | null = null;
        let bestScore = Number.POSITIVE_INFINITY;

        for (const cand of candidates) {
          let score = 0;
          if (prev && cand.startMs < prev.endMs) {
            score += (prev.endMs - cand.startMs) * 3;
          }
          if (next && cand.endMs > next.startMs) {
            score += (cand.endMs - next.startMs) * 3;
          }
          // Penalize deviation from neighborhood consensus minute
          const candMinute = Math.floor((cand.startMs % 3_600_000) / 60_000);
          score += Math.abs(candMinute - baselineMinute) * 5000;

          const duration = cand.endMs - cand.startMs;
          if (duration < 500 || duration > 10_000) {
            score += 2000;
          }
          if (score < bestScore) {
            bestScore = score;
            bestCandidate = cand;
          }
        }

        if (
          bestCandidate &&
          curr.match &&
          (bestCandidate.startMs !== curr.startMs ||
            bestCandidate.endMs !== curr.endMs)
        ) {
          repairedCount++;
          curr.startMs = bestCandidate.startMs;
          curr.endMs = bestCandidate.endMs;
          const newTimingLine = `${formatVttTimestamp(bestCandidate.startMs)} --> ${formatVttTimestamp(bestCandidate.endMs)}${curr.match[3] || ""}`;
          curr.raw = curr.raw.replace(curr.match[0], newTimingLine);
        } else if (isStartGtEnd && candidates.length === 0) {
          droppedCount++;
          curr.raw = "";
        }
      }
    }
  }

  if (timedIndices.length === 0) {
    return vttText;
  }

  // If nothing was repaired or dropped, return the original text untouched
  if (repairedCount === 0 && droppedCount === 0) {
    return vttText;
  }

  let repairedVtt = parsedBlocks
    .map((b) => b.raw)
    .filter((raw) => raw.trim().length > 0)
    .join("\n\n");

  if (!hasVttHeader(repairedVtt)) {
    repairedVtt = `WEBVTT\n\n${repairedVtt}`;
  } else if (!repairedVtt.endsWith("\n\n")) {
    repairedVtt = `${repairedVtt}\n\n`;
  }

  console.info(`[subtitle-repair] Fixed ${repairedCount} broken timestamps`);
  return repairedVtt;
}

export function normalizeSubtitleToVtt(text: string, format?: string): string {
  const textTrimmed = text.replace(/^\uFEFF/, "").trim();
  if (textTrimmed === "") {
    return "WEBVTT\n\n";
  }

  const formatHint = normalizeFormatHint(format);
  const detectedFormat = getDetectedSubtitleFormat(textTrimmed);
  const candidateFormats = [detectedFormat, formatHint, "vtt", "srt"].filter(
    (candidate, index, formats): candidate is string =>
      Boolean(candidate) && formats.indexOf(candidate) === index,
  );

  for (const candidateFormat of candidateFormats) {
    try {
      const input =
        candidateFormat === "vtt" ? prepareVttInput(textTrimmed) : textTrimmed;
      let vtt = convert(input, { from: candidateFormat, to: "vtt" });
      const originalCuesLength = parseVttSubtitles(vtt).length;
      vtt = repairBrokenSrtTimeline(vtt);
      const cues = parseVttSubtitles(vtt);

      if (
        cues.length > 0 ||
        isEmptyVttDocument(textTrimmed) ||
        originalCuesLength > 0
      ) {
        return vtt;
      }
    } catch {
      // Try the next format. The final error below keeps the public contract stable.
    }
  }

  throw new Error("Invalid subtitle format");
}

export const SUBTITLE_AD_PATTERNS: RegExp[] = [
  /https?:\/\/\S+/i,
  /www\.\S+/i,
  /\.(?:org|com|net|link|tv|me)\b/i,
  /\b(?:opensubtitles|subscene|osdb|addic7ed|podnapisi|yify|rarbg|psa)\b/i,
  /\b(?:vip\s+member|remove\s+all\s+ads|advertise\s+your\s+product|support\s+us|watch\s+online|downloaded\s+from)\b/i,
  /\b(?:subtitles?|sync(?:ed)?|resync(?:ed)?|corrected|translated|encoded|ripped|released)\s+by\b/i,
  /\b(?:subtitles?\s+(?:downloaded|created|sync)|dịch\s+bởi|biên\s+dịch|phụ\s+đề\s+bởi|thuyết\s+minh\s+bởi|thực\s+hiện\s+bởi|vietsub\s+bởi|chúc\s+các\s+bạn\s+xem\s+phim\s+vui\s+vẻ|phimmoi|xemphim|motphim|bilutv|tvhay)\b/i,
  /\bosdb\.link\b/i,
];

export function isSubtitleAdOrCredit(text?: string): boolean {
  if (!text) return false;
  const clean = text.replace(/<[^>]*>/g, " ").trim();
  return SUBTITLE_AD_PATTERNS.some((pattern) => pattern.test(clean));
}

export function filterDuplicateCaptionCues(cues: ContentCaption[]) {
  const seen = new Set<string>();
  return cues.filter((cap) => {
    if (isSubtitleAdOrCredit(cap.content) || isSubtitleAdOrCredit(cap.text)) {
      return false;
    }
    const key = `${cap.start}|${cap.end}|${cap.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseVttSubtitles(vtt: string) {
  return parse(vtt).filter((cue) => cue.type === "caption") as CaptionCueType[];
}

export function removeVttAds(vttText: string): string {
  const normalizedVtt = normalizeSubtitleToVtt(vttText);
  return normalizedVtt
    .split(/\r?\n\s*\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const timingLineIndex = lines.findIndex((line) =>
        VTT_TIMING_LINE_RE.test(line),
      );
      if (timingLineIndex === -1) return block;

      const textLines = lines.slice(timingLineIndex + 1).join(" ");
      if (isSubtitleAdOrCredit(textLines)) {
        return null;
      }
      return block;
    })
    .filter((block): block is string => block !== null)
    .join("\n\n");
}

export function parseCanonicalVtt(vttText: string): CaptionCueType[] {
  const vtt = removeVttAds(vttText);
  return filterDuplicateCaptionCues(parseVttSubtitles(vtt)).sort(
    (a, b) => a.start - b.start,
  );
}

export function tryParseCanonicalVtt(vttText: unknown): CaptionCueType[] {
  if (typeof vttText !== "string") return [];

  try {
    return parseCanonicalVtt(vttText);
  } catch {
    return [];
  }
}

function parseVttTimestamp(timestamp: string): number {
  const parts = timestamp.split(":");
  const secondsPart = parts.pop() ?? "0";
  const [seconds, milliseconds] = secondsPart.split(/[.,]/);
  const numericParts = parts.map(Number);

  if (
    numericParts.some((part) => !Number.isFinite(part)) ||
    !Number.isFinite(Number(seconds)) ||
    !Number.isFinite(Number(milliseconds))
  ) {
    return Number.NaN;
  }

  const minutes = numericParts.pop() ?? 0;
  const hours = numericParts.pop() ?? 0;
  return (
    hours * 60 * 60 * 1000 +
    minutes * 60 * 1000 +
    Number(seconds) * 1000 +
    Number(milliseconds)
  );
}

function formatVttTimestamp(milliseconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const remainder = totalMilliseconds % 1000;

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${remainder
    .toString()
    .padStart(3, "0")}`;
}

export interface SubtitleTimingSegment {
  startMs: number;
  endMs: number;
  offsetMs: number;
}

export function shiftVttPiecewiseTimestamps(
  vttText: string,
  segments: SubtitleTimingSegment[],
  fallbackOffsetMs = 0,
): string {
  const normalizedVtt = normalizeSubtitleToVtt(vttText);
  if (!segments || segments.length === 0) {
    return shiftVttTimestamps(vttText, fallbackOffsetMs / 1000);
  }

  const sortedSegments = [...segments].sort((a, b) => a.startMs - b.startMs);

  return normalizedVtt
    .split(/\r?\n\s*\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const timingLineIndex = lines.findIndex((line) =>
        VTT_TIMING_LINE_RE.test(line),
      );
      if (timingLineIndex === -1) return block;

      const textLines = lines.slice(timingLineIndex + 1).join(" ");
      if (isSubtitleAdOrCredit(textLines)) {
        return null;
      }

      const timingLine = lines[timingLineIndex];
      const match = VTT_TIMING_LINE_RE.exec(timingLine);
      if (!match) return block;

      const start = parseVttTimestamp(match[1]);
      const end = parseVttTimestamp(match[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return block;

      let appliedOffsetMs = fallbackOffsetMs;

      let insideSegment = false;
      for (const seg of sortedSegments) {
        if (start >= seg.startMs && start < seg.endMs) {
          appliedOffsetMs = seg.offsetMs;
          insideSegment = true;
          break;
        }
      }

      if (!insideSegment && sortedSegments.length > 0) {
        if (sortedSegments.length === 1) {
          appliedOffsetMs = sortedSegments[0].offsetMs;
        } else if (start < sortedSegments[0].startMs) {
          const s0 = sortedSegments[0];
          const s1 = sortedSegments[1];
          const c0 = (s0.startMs + s0.endMs) / 2;
          const c1 = (s1.startMs + s1.endMs) / 2;
          if (c1 !== c0) {
            let slope = (s1.offsetMs - s0.offsetMs) / (c1 - c0);
            slope = Math.max(-0.1, Math.min(0.1, slope));
            appliedOffsetMs = s0.offsetMs + slope * (start - s0.startMs);
          } else {
            appliedOffsetMs = s0.offsetMs;
          }
        } else if (start >= sortedSegments[sortedSegments.length - 1].endMs) {
          const sLast = sortedSegments[sortedSegments.length - 1];
          const sPrev = sortedSegments[sortedSegments.length - 2];
          const cLast = (sLast.startMs + sLast.endMs) / 2;
          const cPrev = (sPrev.startMs + sPrev.endMs) / 2;
          if (cLast !== cPrev) {
            let slope = (sLast.offsetMs - sPrev.offsetMs) / (cLast - cPrev);
            slope = Math.max(-0.1, Math.min(0.1, slope));
            appliedOffsetMs = sLast.offsetMs + slope * (start - sLast.endMs);
          } else {
            appliedOffsetMs = sLast.offsetMs;
          }
        } else {
          for (let i = 0; i < sortedSegments.length - 1; i++) {
            const s1 = sortedSegments[i];
            let s2 = sortedSegments[i + 1];
            // Find the next non-overlapping segment to interpolate the gap
            for (let j = i + 1; j < sortedSegments.length; j++) {
              if (sortedSegments[j].startMs >= s1.endMs) {
                s2 = sortedSegments[j];
                break;
              }
            }
            if (start >= s1.endMs && start < s2.startMs) {
              const gap = s2.startMs - s1.endMs;
              const slope = (s2.offsetMs - s1.offsetMs) / gap;
              appliedOffsetMs = s1.offsetMs + slope * (start - s1.endMs);
              break;
            }
          }
        }
      }

      const shiftedStart = Math.max(0, start + appliedOffsetMs);
      const shiftedEnd = Math.max(0, end + appliedOffsetMs);
      if (shiftedEnd <= shiftedStart) return null;

      lines[timingLineIndex] =
        `${formatVttTimestamp(shiftedStart)} --> ${formatVttTimestamp(shiftedEnd)}${match[3]}`;
      return {
        start: shiftedStart,
        content: lines.join("\n"),
      };
    })
    .filter(
      (item): item is { start: number; content: string } | string =>
        item !== null,
    )
    .sort((a, b) => {
      if (typeof a === "string" || typeof b === "string") return 0;
      return a.start - b.start;
    })
    .map((item) => (typeof item === "string" ? item : item.content))
    .join("\n\n");
}

export function shiftVttTimestamps(vttText: string, delay: number): string {
  const normalizedVtt = normalizeSubtitleToVtt(vttText);
  const delayMilliseconds = Number.isFinite(delay)
    ? Math.round(delay * 1000)
    : 0;

  return normalizedVtt
    .split(/\r?\n\s*\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const timingLineIndex = lines.findIndex((line) =>
        VTT_TIMING_LINE_RE.test(line),
      );
      if (timingLineIndex === -1) return block;

      const textLines = lines.slice(timingLineIndex + 1).join(" ");
      if (isSubtitleAdOrCredit(textLines)) {
        return null;
      }

      if (delayMilliseconds === 0) return block;

      const timingLine = lines[timingLineIndex];
      const match = VTT_TIMING_LINE_RE.exec(timingLine);
      if (!match) return block;

      const start = parseVttTimestamp(match[1]);
      const end = parseVttTimestamp(match[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return block;

      const shiftedStart = Math.max(0, start + delayMilliseconds);
      const shiftedEnd = Math.max(0, end + delayMilliseconds);
      if (shiftedEnd <= shiftedStart) return null;

      lines[timingLineIndex] =
        `${formatVttTimestamp(shiftedStart)} --> ${formatVttTimestamp(shiftedEnd)}${match[3]}`;
      return lines.join("\n");
    })
    .filter((block): block is string => block !== null)
    .join("\n\n");
}

export function buildVttObjectUrl(
  vttText: string,
  secondaryVttText?: string,
  primaryDelay = 0,
  secondaryDelay = primaryDelay,
): string {
  let vtt = shiftVttTimestamps(vttText, primaryDelay);
  if (secondaryVttText) {
    const secondaryVtt = shiftVttTimestamps(secondaryVttText, secondaryDelay);
    vtt = vtt + "\n\n" + secondaryVtt.replace(/^WEBVTT(?:[\r\n]+)?/i, "");
  }
  return URL.createObjectURL(
    new Blob([vtt], {
      type: "text/vtt",
    }),
  );
}

export function decodeSubtitleBytes(
  buffer: ArrayBuffer | Uint8Array,
  languageHint?: string,
): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length === 0) return "";

  // 1. Check Byte Order Marks (BOM)
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      // Ignore
    }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    try {
      return new TextDecoder("utf-16le").decode(bytes);
    } catch {
      // Ignore
    }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    try {
      return new TextDecoder("utf-16be").decode(bytes);
    } catch {
      // Ignore
    }
  }

  // 2. Check for UTF-16LE without BOM (frequent NUL zeros in Latin text)
  let zeroCount = 0;
  const sampleLength = Math.min(bytes.length, 500);
  for (let i = 0; i < sampleLength; i++) {
    if (bytes[i] === 0) zeroCount++;
  }
  if (sampleLength > 10 && zeroCount / sampleLength > 0.3) {
    try {
      return new TextDecoder("utf-16le").decode(bytes);
    } catch {
      // Ignore
    }
  }

  // 3. Try strict UTF-8 (throws if containing legacy ANSI non-UTF8 bytes like Windows-1258)
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Not valid UTF-8! Proceed to legacy Windows / ANSI / ISO code page detection
  }

  // 4. Legacy encoding mapping based on language hint or common patterns
  const lang = (languageHint || "").toLowerCase().trim();
  let candidateEncodings: string[] = [
    "windows-1258",
    "windows-1252",
    "iso-8859-1",
  ];

  if (
    lang.startsWith("vi") ||
    lang === "vn" ||
    lang.includes("viet") ||
    lang.includes("việt")
  ) {
    candidateEncodings = ["windows-1258", "windows-1252", "utf-16le"];
  } else if (
    lang.startsWith("ru") ||
    lang.startsWith("uk") ||
    lang.startsWith("bg")
  ) {
    candidateEncodings = ["windows-1251", "iso-8859-5", "windows-1252"];
  } else if (
    lang.startsWith("zh") ||
    lang === "gb" ||
    lang.includes("chinese")
  ) {
    candidateEncodings = ["gb18030", "big5", "windows-1252"];
  } else if (lang.startsWith("ja") || lang === "jp" || lang.includes("jap")) {
    candidateEncodings = ["shift_jis", "euc-jp", "windows-1252"];
  } else if (lang.startsWith("ko") || lang === "kr" || lang.includes("kor")) {
    candidateEncodings = ["euc-kr", "windows-1252"];
  } else if (
    lang.startsWith("pl") ||
    lang.startsWith("cs") ||
    lang.startsWith("sk") ||
    lang.startsWith("hu") ||
    lang.startsWith("ro") ||
    lang.startsWith("hr")
  ) {
    candidateEncodings = ["windows-1250", "windows-1252"];
  } else if (lang.startsWith("ar") || lang.includes("arab")) {
    candidateEncodings = ["windows-1256", "windows-1252"];
  } else if (lang.startsWith("he") || lang.includes("heb")) {
    candidateEncodings = ["windows-1255", "windows-1252"];
  } else if (lang.startsWith("tr") || lang.includes("turk")) {
    candidateEncodings = ["windows-1254", "windows-1252"];
  } else if (lang.startsWith("el") || lang.includes("greek")) {
    candidateEncodings = ["windows-1253", "windows-1252"];
  }

  for (const encoding of candidateEncodings) {
    try {
      const text = new TextDecoder(encoding).decode(bytes);
      if (text.includes("\uFFFD")) continue;

      if (encoding === "windows-1258") {
        const invalidCombiningRegex =
          /[^aăâeêioôơuưyAĂÂEÊIOÔƠUƯY][\u0300\u0301\u0303\u0309\u0323]/;
        if (invalidCombiningRegex.test(text)) {
          continue;
        }
      }

      return text;
    } catch {
      // Ignore
    }
  }

  try {
    return new TextDecoder("windows-1258").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function isHearingImpairedCaption(sub?: {
  isHearingImpaired?: boolean;
  hearing_impaired?: boolean | string | number;
  hearingImpaired?: boolean | string | number;
  hi?: boolean | string | number;
  label?: string;
  display?: string;
  media?: string;
  url?: string;
}): boolean {
  if (!sub) return false;

  if (
    sub.isHearingImpaired === true ||
    sub.hearing_impaired === true ||
    sub.hearing_impaired === "true" ||
    sub.hearing_impaired === 1 ||
    sub.hearing_impaired === "1" ||
    sub.hearingImpaired === true ||
    sub.hearingImpaired === "true" ||
    sub.hearingImpaired === 1 ||
    sub.hearingImpaired === "1" ||
    sub.hi === true ||
    sub.hi === "true" ||
    sub.hi === 1 ||
    sub.hi === "1"
  ) {
    return true;
  }

  const textToScan = [sub.label, sub.display, sub.media, sub.url]
    .filter(Boolean)
    .join(" ");
  if (!textToScan) return false;

  const hiRegex =
    /(?:^|[._\s\-[\]()])(hi|sdh)(?:$|[._\s\-[\]()])|\bhearing[._\s-]?impaired\b/i;
  return hiRegex.test(textToScan);
}
