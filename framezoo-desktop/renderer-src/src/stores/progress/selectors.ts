import { PlayerMeta } from "@/stores/player/slices/source";

import { ProgressItem, ProgressMediaItem } from ".";

export function getSavedProgressItem(
  items: Record<string, ProgressMediaItem>,
  meta: PlayerMeta | null,
): ProgressItem | null {
  const item = items[meta?.tmdbId ?? ""];
  if (!item || !meta) return null;

  if (meta.type === "movie") {
    return item.progress ?? null;
  }

  const episodeId = meta.episode?.tmdbId;
  if (!episodeId) return null;

  return item.episodes[episodeId]?.progress ?? null;
}

export function getSavedProgressTime(
  items: Record<string, ProgressMediaItem>,
  meta: PlayerMeta | null,
): number {
  return getSavedProgressItem(items, meta)?.watched ?? 0;
}
