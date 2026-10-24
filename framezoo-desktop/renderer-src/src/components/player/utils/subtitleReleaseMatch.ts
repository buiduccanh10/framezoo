import type { CaptionListItem } from "@/stores/player/slices/source";

type ReleaseTags = {
  resolution?: string;
  source?: string;
  codec?: string;
  hdr?: string;
  audio?: string;
  group?: string;
};

const TAG_WEIGHTS: Record<keyof ReleaseTags, number> = {
  resolution: 24,
  source: 22,
  codec: 14,
  hdr: 14,
  audio: 14,
  group: 12,
};

function normalizeReleaseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\.(?=[a-z0-9])/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getReleaseTags(value: string): ReleaseTags {
  const name = normalizeReleaseName(value);
  const tags: ReleaseTags = {};

  const resolution = name.match(
    /\b(2160p|4k|uhd|1440p|1080p|720p|576p|480p)\b/,
  );
  if (resolution) {
    tags.resolution = ["4k", "uhd"].includes(resolution[1])
      ? "2160p"
      : resolution[1];
  }

  if (/\bweb[ -]?dl\b/.test(name)) tags.source = "web-dl";
  else if (/\bweb[ -]?rip\b/.test(name)) tags.source = "web-rip";
  else if (/\bblu[ -]?ray\b|\bbluray\b|\bbdrip\b|\bbr[ -]?rip\b/.test(name)) {
    tags.source = "bluray";
  } else if (/\bremux\b/.test(name)) tags.source = "remux";
  else if (/\bhdtv\b/.test(name)) tags.source = "hdtv";
  else if (/\b(?:hdtc|hdcam|cam|telesync|tsrip)\b/.test(name)) {
    tags.source = "cam";
  }

  if (/\b(?:x265|h[ .]?265|hevc)\b/.test(name)) tags.codec = "hevc";
  else if (/\b(?:x264|h[ .]?264|avc)\b/.test(name)) tags.codec = "h264";
  else if (/\bav1\b/.test(name)) tags.codec = "av1";

  if (/\bdv(?:hdr)?\b|\bdolby[ -]?vision\b/.test(name)) {
    tags.hdr = "dolby-vision";
  }
  else if (/\bhdr10\+?\b/.test(name)) {
    tags.hdr = /hdr10\+/.test(name) ? "hdr10+" : "hdr10";
  } else if (/\bhdr\b/.test(name)) tags.hdr = "hdr";
  else if (/\bsdr\b/.test(name)) tags.hdr = "sdr";

  const audio = name.match(
    /\b(atmos|ddp?\s?\d(?:\.\d)?|dts(?:[ -]?hd)?|truehd|aac|ac3|eac3)\b/,
  );
  if (audio) {
    const token = audio[1].replace(/\s+/g, "");
    tags.audio = token === "eac3" || token === "ddp" ? "ddp" : token;
  }

  // Release group usually follows a final dash. Leading bracketed tags are
  // often the subtitle uploader (for example [MCUDISVN]), so ignore them.
  const group = value.match(
    /-([a-z0-9]+)(?:\[[^\]]+\])?(?:\.[a-z0-9]+)?$/i,
  );
  if (group && !/^\d/.test(group[1])) tags.group = group[1].toLowerCase();

  return tags;
}

/** Returns null when the names do not share enough explicit release tags. */
export function scoreSubtitleReleaseMatch(
  caption: CaptionListItem,
  streamReleaseName?: string | null,
): number | null {
  if (!streamReleaseName) return null;
  const captionName = [caption.display, caption.media]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ");
  if (!captionName) return null;

  const streamTags = getReleaseTags(streamReleaseName);
  const captionTags = getReleaseTags(captionName);
  let comparableWeight = 0;
  let matchedWeight = 0;

  for (const key of Object.keys(TAG_WEIGHTS) as Array<keyof ReleaseTags>) {
    const streamValue = streamTags[key];
    const captionValue = captionTags[key];
    if (!streamValue || !captionValue) continue;
    const weight = TAG_WEIGHTS[key];
    comparableWeight += weight;
    if (streamValue === captionValue) matchedWeight += weight;
  }

  if (comparableWeight < TAG_WEIGHTS.resolution) return null;
  return Math.round((matchedWeight / comparableWeight) * 100);
}
