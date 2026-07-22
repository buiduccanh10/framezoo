import DOMPurify from "dompurify";
import { convert, detect, parse } from "subsrt-ts";
import { ContentCaption } from "subsrt-ts/dist/types/handler";

import { RunOutput } from "@/lib/providers";
import { CaptionListItem } from "@/stores/player/slices/source";

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
    Math.max(0, delayedEnd) >= currentTime
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

export function normalizeSubtitleToVtt(text: string, format?: string): string {
  const textTrimmed = text.replace(/^\uFEFF/, "").trim();
  if (textTrimmed === "") {
    throw new Error("Given text is empty");
  }
  const formatHint = format?.trim().toLowerCase().replace(/^\./, "");
  const vtt =
    formatHint && SUBTITLE_FORMATS.has(formatHint)
      ? convert(textTrimmed, { from: formatHint, to: "vtt" })
      : convert(textTrimmed, "vtt");
  if (detect(vtt) === "") {
    throw new Error("Invalid subtitle format");
  }
  return vtt;
}

export function filterDuplicateCaptionCues(cues: ContentCaption[]) {
  const seen = new Set<string>();
  return cues.filter((cap) => {
    const key = `${cap.start}|${cap.end}|${cap.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseVttSubtitles(vtt: string) {
  return parse(vtt).filter((cue) => cue.type === "caption") as CaptionCueType[];
}

export function parseCanonicalVtt(vttText: string): CaptionCueType[] {
  const vtt = normalizeSubtitleToVtt(vttText);
  return filterDuplicateCaptionCues(parseVttSubtitles(vtt));
}

const VTT_TIMING_LINE_RE =
  /^\s*((?:\d+:)?\d{1,2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}\.\d{3})(.*)$/;

function parseVttTimestamp(timestamp: string): number {
  const parts = timestamp.split(":");
  const secondsPart = parts.pop() ?? "0";
  const [seconds, milliseconds] = secondsPart.split(".");
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

export function shiftVttTimestamps(vttText: string, delay: number): string {
  const normalizedVtt = normalizeSubtitleToVtt(vttText);
  const delayMilliseconds = Number.isFinite(delay)
    ? Math.round(delay * 1000)
    : 0;

  if (delayMilliseconds === 0) return normalizedVtt;

  return normalizedVtt
    .split(/\r?\n\s*\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const timingLineIndex = lines.findIndex((line) =>
        VTT_TIMING_LINE_RE.test(line),
      );
      if (timingLineIndex === -1) return block;

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
  delay = 0,
): string {
  let vtt = shiftVttTimestamps(vttText, delay);
  if (secondaryVttText) {
    const secondaryVtt = shiftVttTimestamps(secondaryVttText, delay);
    vtt = vtt + "\n\n" + secondaryVtt.replace(/^WEBVTT(?:[\r\n]+)?/i, "");
  }
  return URL.createObjectURL(
    new Blob([vtt], {
      type: "text/vtt",
    }),
  );
}

export function convertProviderCaption(
  captions: RunOutput["stream"]["captions"],
): CaptionListItem[] {
  return captions.map((v) => ({
    id: v.id,
    language: v.language,
    url: v.url,
    type: (v as any).type,
    needsProxy: v.hasCorsRestrictions,
    opensubtitles: v.opensubtitles,
    // subtitle details from wyzie
    display: (v as any).display,
    media: (v as any).media,
    isHearingImpaired: (v as any).isHearingImpaired,
    source: (v as any).source,
    encoding: (v as any).encoding,
  }));
}
