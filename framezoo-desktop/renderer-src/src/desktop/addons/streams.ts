import { hasResource, supportsType } from "./manifest";
import type {
  AddonStream,
  AddonStreamLoadError,
  AddonStreamLoadResult,
  InstalledAddon,
  StremioStream,
} from "./types";

export type AddonStreamMedia = {
  type: "movie" | "series";
  id: string;
  season?: number;
  episode?: number;
};

export const ADDON_STREAMS_STALE_TIME_MS = 10 * 60 * 1000;
export const ADDON_STREAMS_GC_TIME_MS = 60 * 60 * 1000;

export interface AddonStreamPreference {
  addonId: string;
  sourceKind?: AddonStream["kind"];
  quality: string;
  name: string;
  title: string;
  bingeGroup?: string;
}

export function getAddonStreamQueryKey(
  addon: InstalledAddon,
  media: AddonStreamMedia,
) {
  return [
    "addon-streams",
    addon.manifest.id,
    addon.manifest.version,
    addon.manifestUrl,
    addon.baseUrl,
    media.type,
    media.id,
    media.season ?? null,
    media.episode ?? null,
  ] as const;
}

export function getAddonStreamQuality(stream: AddonStream): string {
  const text = [stream.name, stream.title, stream.description, stream.fileName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(4k|2160p|uhd)\b/.test(text)) return "4K";
  if (/\b(1440p|2k|qhd)\b/.test(text)) return "1440p";
  if (/\b(1080p|1080i|fhd|full\s*hd)\b/.test(text)) return "1080p";
  if (/\b(720p|720i|hd)\b/.test(text)) return "720p";
  if (/\b(480p|480i|360p|240p|sd|dvd|cam|ts)\b/.test(text)) return "480p";
  return "other";
}

function streamLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractPreferenceWords(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
}

function extractReleaseGroup(title: string): string | null {
  const bracketMatch = title.match(/\[([a-z0-9_-]+)\]/i);
  if (bracketMatch?.[1]) return bracketMatch[1].toLowerCase();

  const hyphenMatch = title.match(/[-.]([a-z0-9]+)(?:\.mkv|\.mp4)?$/i);
  if (hyphenMatch?.[1]) return hyphenMatch[1].toLowerCase();

  return null;
}

function normalizeReleaseTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bs\d+e\d+\b/gi, "")
    .replace(/\b(?:season|s)\s*\d+/gi, "")
    .replace(/\b(?:episode|ep|e)\s*\d+/gi, "")
    .replace(/\b\d+x\d+\b/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim();
}

export function matchesAddonStreamPreference(
  stream: AddonStream,
  preference: AddonStreamPreference,
): boolean {
  if (
    stream.addonId !== preference.addonId ||
    (preference.sourceKind && stream.kind !== preference.sourceKind) ||
    getAddonStreamQuality(stream) !== preference.quality
  ) {
    return false;
  }

  // Stremio's stable cross-episode identity is bingeGroup.
  if (preference.bingeGroup && stream.bingeGroup) {
    return stream.bingeGroup === preference.bingeGroup;
  }

  const streamName = stream.name || "";
  if (streamName !== (preference.name || "")) return false;

  const streamTitleLines = streamLines(stream.title || "");
  const preferenceTitleLines = streamLines(preference.title || "");
  if (streamTitleLines.length === 0 || preferenceTitleLines.length === 0) {
    return stream.title === preference.title;
  }

  // Compare the first line (the torrent / pack / release title)
  const streamFirstLine = streamTitleLines[0];
  const preferenceFirstLine = preferenceTitleLines[0];

  if (streamFirstLine === preferenceFirstLine) return true;

  const normStream = normalizeReleaseTitle(streamFirstLine);
  const normPref = normalizeReleaseTitle(preferenceFirstLine);
  if (normStream && normPref && normStream === normPref) return true;

  return false;
}

export function findAddonStreamPreference(
  streams: AddonStream[],
  preference: AddonStreamPreference,
): AddonStream | null {
  const compatibleStreams = streams.filter(
    (stream) =>
      stream.addonId === preference.addonId &&
      (!preference.sourceKind || stream.kind === preference.sourceKind),
  );

  if (compatibleStreams.length === 0) return null;

  // 1. Exact match by bingeGroup or title heuristics
  const exactMatch = compatibleStreams.find((stream) =>
    matchesAddonStreamPreference(stream, preference),
  );
  if (exactMatch) return exactMatch;

  // 2. Score candidate streams based on title similarity, release group, and matching quality
  const preferenceTitleLines = streamLines(preference.title || "");
  const preferenceFirstLine = preferenceTitleLines[0] || preference.title || "";
  const normPref = normalizeReleaseTitle(preferenceFirstLine);
  const preferenceWords = extractPreferenceWords(preferenceFirstLine);
  const prefGroup = extractReleaseGroup(preferenceFirstLine);

  let bestStream: AddonStream | null = null;
  let highestScore = -1;

  for (const stream of compatibleStreams) {
    let score = 0;
    const quality = getAddonStreamQuality(stream);
    if (quality === preference.quality) {
      score += 100;
    }

    const streamTitleLines = streamLines(stream.title || "");
    const streamFirstLine = streamTitleLines[0] || stream.title || "";
    const normStream = normalizeReleaseTitle(streamFirstLine);

    if (streamFirstLine && streamFirstLine === preferenceFirstLine) {
      score += 1000;
    } else if (normStream && normPref && normStream === normPref) {
      score += 800;
    }

    const streamGroup = extractReleaseGroup(streamFirstLine);
    if (prefGroup && streamGroup && prefGroup === streamGroup) {
      score += 500;
    }

    const streamWords = extractPreferenceWords(streamFirstLine);
    if (streamWords.length > 0 && preferenceWords.length > 0) {
      const commonCount = streamWords.filter((w) =>
        preferenceWords.includes(w),
      ).length;
      const totalWords = new Set([...streamWords, ...preferenceWords]).size;
      const jaccard = totalWords > 0 ? commonCount / totalWords : 0;
      score += Math.round(jaccard * 300);
    }

    if (score > highestScore) {
      highestScore = score;
      bestStream = stream;
    }
  }

  return (
    bestStream ??
    compatibleStreams.find(
      (stream) => getAddonStreamQuality(stream) === preference.quality,
    ) ??
    compatibleStreams[0] ??
    null
  );
}

function getStreamKind(stream: StremioStream): AddonStream["kind"] | null {
  const url = stream.url?.trim() ?? "";
  const filename = stream.behaviorHints?.filename?.toLowerCase() ?? "";
  if (
    stream.infoHash ||
    url.startsWith("magnet:") ||
    filename.endsWith(".torrent") ||
    url.endsWith(".torrent")
  ) {
    return "torrent";
  }
  if (/\.m3u8(?:$|[?#])/i.test(url)) return "hls";
  if (/\.mpd(?:$|[?#])/i.test(url)) return "dash";
  if (url) return "file";
  return null;
}

function extractInfoHash(stream: StremioStream) {
  if (stream.infoHash) {
    return stream.infoHash
      .trim()
      .replace(/^urn:btih:/i, "")
      .toLowerCase();
  }

  try {
    const url = new URL(stream.url ?? "");
    return (
      url.searchParams
        .get("xt")
        ?.replace(/^urn:btih:/i, "")
        .toLowerCase() || null
    );
  } catch {
    return null;
  }
}

function getStreamTrackers(stream: StremioStream): string[] {
  const values = [
    ...(stream.sources ?? []),
    ...(() => {
      try {
        return new URL(stream.url ?? "").searchParams.getAll("tr");
      } catch {
        return [];
      }
    })(),
  ];

  const trackers: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    const tracker = /^tracker:/i.test(normalized)
      ? normalized.slice("tracker:".length).trim()
      : normalized;
    if (
      !/^(?:https?|udp):\/\//i.test(tracker) ||
      seen.has(tracker.toLowerCase())
    ) {
      continue;
    }
    seen.add(tracker.toLowerCase());
    trackers.push(tracker);
  }
  return trackers;
}

function getStreamUrl(
  stream: StremioStream,
  kind: AddonStream["kind"],
  trackers: string[],
) {
  const url = stream.url?.trim();
  if (url) {
    if (kind !== "torrent" || !url.toLowerCase().startsWith("magnet:")) {
      return url;
    }
    try {
      const magnet = new URL(url);
      const existing = new Set(
        magnet.searchParams.getAll("tr").map((value) => value.toLowerCase()),
      );
      for (const tracker of trackers) {
        if (!existing.has(tracker.toLowerCase())) {
          magnet.searchParams.append("tr", tracker);
        }
      }
      return magnet.toString();
    } catch {
      return url;
    }
  }

  const infoHash = extractInfoHash(stream);
  if (kind === "torrent" && infoHash) {
    const magnet = new URL(`magnet:?xt=urn:btih:${infoHash}`);
    for (const tracker of trackers) {
      magnet.searchParams.append("tr", tracker);
    }
    return magnet.toString();
  }

  return null;
}

export function normalizeAddonStreams(
  addon: InstalledAddon,
  streams: StremioStream[],
) {
  return streams.flatMap<AddonStream>((stream, index) => {
    const kind = getStreamKind(stream);
    const trackers = getStreamTrackers(stream);
    const url = kind ? getStreamUrl(stream, kind, trackers) : null;
    if (!kind || !url) return [];

    return [
      {
        id: `${addon.manifest.id}:${index}:${stream.infoHash ?? url}`,
        addonId: addon.manifest.id,
        addonName: addon.manifest.name,
        kind,
        name: stream.name?.trim() || addon.manifest.name,
        title: stream.title?.trim() ?? "",
        description: stream.description?.trim() || "",
        url,
        infoHash: extractInfoHash(stream),
        trackers,
        fileIdx: Number.isInteger(stream.fileIdx)
          ? (stream.fileIdx ?? null)
          : null,
        fileName: stream.behaviorHints?.filename ?? null,
        videoSize: stream.behaviorHints?.videoSize ?? null,
        subtitles: stream.subtitles ?? [],
        headers: stream.behaviorHints?.proxyHeaders?.request ?? undefined,
        bingeGroup: stream.behaviorHints?.bingeGroup,
      },
    ];
  });
}

export async function loadAllAddonStreams(
  addons: InstalledAddon[],
  media: AddonStreamMedia,
  load: (
    addon: InstalledAddon,
    media: AddonStreamMedia,
  ) => Promise<StremioStream[]>,
) {
  const result = await loadAllAddonStreamsDetailed(addons, media, load);
  return result.streams;
}

export async function loadAllAddonStreamsDetailed(
  addons: InstalledAddon[],
  media: AddonStreamMedia,
  load: (
    addon: InstalledAddon,
    media: AddonStreamMedia,
  ) => Promise<StremioStream[]>,
): Promise<AddonStreamLoadResult> {
  const eligibleAddons = addons
    .filter((addon) => addon.enabled)
    .filter((addon) => hasResource(addon, "stream"))
    .filter((addon) => supportsType(addon, media.type));

  console.debug("[desktop-addon] eligible addons", {
    media,
    addons: eligibleAddons.map((addon) => ({
      id: addon.manifest.id,
      name: addon.manifest.name,
      type: media.type,
    })),
  });

  const results = await Promise.allSettled(
    eligibleAddons.map(async (addon) => {
      const streams = await load(addon, media);
      const normalizedStreams = normalizeAddonStreams(addon, streams);
      console.debug("[desktop-addon] streams normalized", {
        addonId: addon.manifest.id,
        addonName: addon.manifest.name,
        rawCount: streams.length,
        streamCount: normalizedStreams.length,
      });
      return normalizedStreams;
    }),
  );

  const streams: AddonStream[] = [];
  const errors: AddonStreamLoadError[] = [];

  results.forEach((result, index) => {
    const addon = eligibleAddons[index];
    if (!addon) return;

    if (result.status === "fulfilled") {
      streams.push(...result.value);
      return;
    }

    const message =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason ?? "Unknown addon error");
    errors.push({
      addonId: addon.manifest.id,
      addonName: addon.manifest.name,
      url: addon.manifestUrl,
      message,
    });
    console.error("[desktop-addon] stream request failed", {
      addonId: addon.manifest.id,
      addonName: addon.manifest.name,
      media,
      message,
    });
  });

  return { streams, errors };
}
