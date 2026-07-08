export function getOpenMovieProviderFromStreamId(
  streamId: string | null | undefined,
): string | null {
  if (!streamId?.startsWith("openmovie-")) {
    return null;
  }

  const parts = streamId.split("-");
  if (parts.length < 4) {
    return null;
  }

  const provider = parts.slice(1, -2).join("-");
  return provider || null;
}

export function isOpenMovieHlsUrl(url: string): boolean {
  return (
    url.includes("m3u8") ||
    url.includes("/api/streams/") ||
    url.includes("/m3u8-proxy") ||
    url.includes(".m3u8")
  );
}

export function normalizeOpenMovieQuality(
  quality: string | null | undefined,
): string {
  const qualityMap: Record<string, string> = {
    "2160p": "4k",
    "1440p": "1440",
    "1080p": "1080",
    "720p": "720",
    "480p": "480",
    "360p": "360",
  };

  if (!quality) {
    return "unknown";
  }

  return qualityMap[quality] || quality.replace("p", "") || "unknown";
}

export function buildOpenMovieStreamId({
  provider,
  url,
  quality,
  variantId,
}: {
  provider: string;
  url: string;
  quality: string | null | undefined;
  variantId?: string | null;
}): string {
  const streamVariantId = (variantId || provider || "")
    .trim()
    .replace(/\s+/g, "-");
  return `openmovie-${streamVariantId}-${isOpenMovieHlsUrl(url) ? "hls" : "file"}-${normalizeOpenMovieQuality(quality)}`;
}

export function formatOpenMovieVariantLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "kkphim_vietsub") return "Vietsub";
  if (normalized === "kkphim_long_tieng") return "Lồng tiếng";

  return provider
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getOpenMovieVariantLabelFromStreamId(
  streamId: string | null | undefined,
): string | null {
  const provider = getOpenMovieProviderFromStreamId(streamId);
  return provider ? formatOpenMovieVariantLabel(provider) : null;
}

export function formatKkphimSourceName(
  sourceName: string,
  variantLabel: string | null | undefined,
): string {
  if (!variantLabel) {
    return sourceName;
  }

  return sourceName.replace(/\(KKPhim[^)]*\)/, `(KKPhim ${variantLabel})`);
}
