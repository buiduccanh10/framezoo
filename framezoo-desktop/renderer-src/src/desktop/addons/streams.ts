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
  return value.toLowerCase().match(/[a-z]{4,}/g) || [];
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

  // Stremio's stable cross-episode identity is bingeGroup. Do not fall back
  // to title heuristics when the selected stream supplied one.
  if (preference.bingeGroup) {
    return stream.bingeGroup === preference.bingeGroup;
  }

  const streamName = stream.name || "";
  if (streamName !== (preference.name || "")) return false;

  const streamTitleLines = streamLines(stream.title || "");
  const preferenceTitleLines = streamLines(preference.title || "");
  if (streamTitleLines.length === 0 || preferenceTitleLines.length === 0) {
    return stream.title === preference.title;
  }

  const streamLastLine = streamTitleLines[streamTitleLines.length - 1];
  const preferenceLastLine =
    preferenceTitleLines[preferenceTitleLines.length - 1];
  const streamWords = extractPreferenceWords(streamLastLine);
  const preferenceWords = extractPreferenceWords(preferenceLastLine);

  return (
    streamWords.some((word) => preferenceWords.includes(word)) ||
    streamLastLine === preferenceLastLine
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

function getStreamUrl(stream: StremioStream, kind: AddonStream["kind"]) {
  const url = stream.url?.trim();
  if (url) return url;

  const infoHash = extractInfoHash(stream);
  if (kind === "torrent" && infoHash) {
    return `magnet:?xt=urn:btih:${infoHash}`;
  }

  return null;
}

export function normalizeAddonStreams(
  addon: InstalledAddon,
  streams: StremioStream[],
) {
  return streams.flatMap<AddonStream>((stream, index) => {
    const kind = getStreamKind(stream);
    const url = kind ? getStreamUrl(stream, kind) : null;
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
