import { supportsType } from "./manifest";
import type {
  AddonStream,
  AddonStreamLoadError,
  AddonStreamLoadResult,
  InstalledAddon,
  StremioStream,
} from "./types";

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
        subtitles: Array.isArray(stream.subtitles) ? stream.subtitles : [],
        headers: stream.behaviorHints?.proxyHeaders?.request,
      },
    ];
  });
}

export async function loadAllAddonStreams(
  addons: InstalledAddon[],
  media: {
    type: "movie" | "series";
    id: string;
    season?: number;
    episode?: number;
  },
  load: (
    addon: InstalledAddon,
    media: {
      type: "movie" | "series";
      id: string;
      season?: number;
      episode?: number;
    },
  ) => Promise<StremioStream[]>,
) {
  const result = await loadAllAddonStreamsDetailed(addons, media, load);
  return result.streams;
}

export async function loadAllAddonStreamsDetailed(
  addons: InstalledAddon[],
  media: {
    type: "movie" | "series";
    id: string;
    season?: number;
    episode?: number;
  },
  load: (
    addon: InstalledAddon,
    media: {
      type: "movie" | "series";
      id: string;
      season?: number;
      episode?: number;
    },
  ) => Promise<StremioStream[]>,
): Promise<AddonStreamLoadResult> {
  const eligibleAddons = addons
    .filter((addon) => addon.enabled)
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
