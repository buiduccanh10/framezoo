import DOMPurify from "dompurify";
import { convert, detect, parse } from "subsrt-ts";
import { ContentCaption } from "subsrt-ts/dist/types/handler";

import { RunOutput } from "@/lib/providers";
import { CaptionListItem } from "@/stores/player/slices/source";

export type CaptionCueType = ContentCaption;
export const sanitize = DOMPurify.sanitize;

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

export function makeQueId(index: number, start: number, end: number): string {
  return `${index}-${start}-${end}`;
}

export function normalizeSubtitleToVtt(text: string): string {
  const textTrimmed = text.trim();
  if (textTrimmed === "") {
    throw new Error("Given text is empty");
  }
  const vtt = convert(textTrimmed, "vtt");
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

export function buildVttObjectUrl(
  vttText: string,
  secondaryVttText?: string,
): string {
  let vtt = normalizeSubtitleToVtt(vttText);
  if (secondaryVttText) {
    const secondaryVtt = normalizeSubtitleToVtt(secondaryVttText);
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
