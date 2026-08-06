import { SourceQuality, allQualities } from "@/stores/player/utils/qualities";

import {
  getOpenMovieProviderFromStreamId,
  normalizeOpenMovieQuality,
} from "./openMovieVariant";

type CachedSourceEmbed = {
  embedId: string;
  url: string;
};

type OpenMovieEmbedInfo = {
  provider?: string;
  variantId?: string;
  quality?: string;
};

const sourceEmbedsCache = new Map<string, CachedSourceEmbed[]>();
const allowedQualities = new Set<SourceQuality>(allQualities);

function buildCacheKey(sourceId: string, mediaKey: string): string {
  return `${sourceId}::${mediaKey}`;
}

function decodeOpenMovieEmbedInfo(url: string): OpenMovieEmbedInfo | null {
  if (!url.startsWith("openmovie://")) return null;

  try {
    const encoded = url.replace("openmovie://", "");
    return JSON.parse(decodeURIComponent(encoded)) as OpenMovieEmbedInfo;
  } catch {
    return null;
  }
}

function normalizeVariantId(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, "-");
  return normalized || null;
}

export function cacheSourceEmbeds(
  sourceId: string,
  mediaKey: string,
  embeds: Array<{ embedId: string; url: string }>,
) {
  sourceEmbedsCache.set(buildCacheKey(sourceId, mediaKey), embeds);
}

export function clearCachedSourceEmbeds(
  sourceId?: string | null,
  mediaKey?: string | null,
) {
  if (!sourceId || !mediaKey) return;
  sourceEmbedsCache.delete(buildCacheKey(sourceId, mediaKey));
}

export function getOpenMovieMenuQualities(
  sourceId: string | null,
  mediaKey: string | null,
  streamId: string | null | undefined,
): SourceQuality[] {
  if (!sourceId || !mediaKey || !streamId) return [];

  const currentVariantId = getOpenMovieProviderFromStreamId(streamId);
  const embeds = sourceEmbedsCache.get(buildCacheKey(sourceId, mediaKey));

  if (!currentVariantId || !embeds?.length) return [];

  const qualities = new Set<SourceQuality>();

  embeds.forEach((embed) => {
    if (embed.embedId !== "openmovie-embed") return;

    const info = decodeOpenMovieEmbedInfo(embed.url);
    if (!info) return;

    const embedVariantId = normalizeVariantId(info.variantId || info.provider);
    if (!embedVariantId || embedVariantId !== currentVariantId) return;

    const normalizedQuality = normalizeOpenMovieQuality(info.quality);
    if (!allowedQualities.has(normalizedQuality as SourceQuality)) return;
    if (normalizedQuality === "unknown") return;

    qualities.add(normalizedQuality as SourceQuality);
  });

  return allQualities.filter(
    (quality) => quality !== "unknown" && qualities.has(quality),
  );
}
