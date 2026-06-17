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
