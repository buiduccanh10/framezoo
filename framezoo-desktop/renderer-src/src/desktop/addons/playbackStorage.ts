import type { PlayerMeta } from "@/stores/player/slices/source";

import type { AddonStreamPreference } from "./streams";
import type { AddonStream } from "./types";

const STORAGE_KEY = "framezoo.desktop.playback-selections.v1";
const PREFERENCE_STORAGE_KEY = "framezoo.desktop.stream-preferences.v1";
const STORAGE_VERSION = 1 as const;

export interface SavedTorrentSelection {
  version: typeof STORAGE_VERSION;
  mediaKey: string;
  addonId: string;
  streamId: string;
  url: string;
  infoHash: string | null;
  fileIdx: number | null;
  fileName: string | null;
  savedAt: number;
}

type SavedTorrentSelectionMap = Record<string, SavedTorrentSelection>;

export interface SavedStreamPreference extends AddonStreamPreference {
  version: typeof STORAGE_VERSION;
  seriesId: string;
  savedAt: number;
}

type SavedStreamPreferenceMap = Record<string, SavedStreamPreference>;

function readSelections(): SavedTorrentSelectionMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as SavedTorrentSelectionMap;
  } catch {
    return {};
  }
}

function writeSelections(selections: SavedTorrentSelectionMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selections));
  } catch {
    // Playback continues even when storage is unavailable or full.
  }
}

function readPreferences(): SavedStreamPreferenceMap {
  try {
    const raw = localStorage.getItem(PREFERENCE_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as SavedStreamPreferenceMap;
  } catch {
    return {};
  }
}

function writePreferences(preferences: SavedStreamPreferenceMap) {
  try {
    localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Playback continues even when storage is unavailable or full.
  }
}

export function getPlaybackSelectionKey(meta: PlayerMeta): string | null {
  if (!meta.tmdbId) return null;
  if (meta.type === "movie") return `movie:${meta.tmdbId}`;

  if (!meta.season?.tmdbId || !meta.episode?.tmdbId) return null;
  return `show:${meta.tmdbId}:${meta.season.tmdbId}:${meta.episode.tmdbId}`;
}

export function getLastTorrentSelection(
  meta: PlayerMeta,
): SavedTorrentSelection | null {
  const mediaKey = getPlaybackSelectionKey(meta);
  if (!mediaKey) return null;

  const selection = readSelections()[mediaKey];
  if (!selection || selection.version !== STORAGE_VERSION) return null;
  return selection;
}

export function getLastStreamPreference(
  meta: PlayerMeta,
): SavedStreamPreference | null {
  if (meta.type !== "show" || !meta.tmdbId) return null;

  const preference = readPreferences()[meta.tmdbId];
  if (!preference || preference.version !== STORAGE_VERSION) return null;
  return preference;
}

export function saveLastStreamPreference(
  meta: PlayerMeta,
  stream: AddonStream,
  quality: string,
): void {
  if (meta.type !== "show" || !meta.tmdbId) return;

  const preferences = readPreferences();
  preferences[meta.tmdbId] = {
    version: STORAGE_VERSION,
    seriesId: meta.tmdbId,
    addonId: stream.addonId,
    sourceKind: stream.kind,
    quality,
    name: stream.name || "",
    title: stream.title || "",
    bingeGroup: stream.bingeGroup,
    savedAt: Date.now(),
  };
  writePreferences(preferences);
}

export function saveLastTorrentSelection(
  meta: PlayerMeta,
  stream: AddonStream,
): void {
  if (stream.kind !== "torrent") return;

  const mediaKey = getPlaybackSelectionKey(meta);
  if (!mediaKey) return;

  const selections = readSelections();
  selections[mediaKey] = {
    version: STORAGE_VERSION,
    mediaKey,
    addonId: stream.addonId,
    streamId: stream.id,
    url: stream.url,
    infoHash: stream.infoHash,
    fileIdx: stream.fileIdx,
    fileName: stream.fileName,
    savedAt: Date.now(),
  };
  writeSelections(selections);
}

export function clearLastTorrentSelection(meta: PlayerMeta): void {
  const mediaKey = getPlaybackSelectionKey(meta);
  if (!mediaKey) return;

  const selections = readSelections();
  if (!selections[mediaKey]) return;

  delete selections[mediaKey];
  writeSelections(selections);
}

export function clearMediaPlaybackStorage(tmdbId: string | number): void {
  const idStr = String(tmdbId).trim();
  if (!idStr) return;

  const selections = readSelections();
  let hasSelectionChanges = false;

  for (const key of Object.keys(selections)) {
    if (key === `movie:${idStr}` || key.startsWith(`show:${idStr}:`)) {
      delete selections[key];
      hasSelectionChanges = true;
    }
  }

  if (hasSelectionChanges) {
    writeSelections(selections);
  }

  const preferences = readPreferences();
  if (preferences[idStr]) {
    delete preferences[idStr];
    writePreferences(preferences);
  }
}

export function clearAllPlaybackStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PREFERENCE_STORAGE_KEY);
  } catch {
    // Playback continues even when storage is unavailable or full.
  }
}

function sameFileSelection(
  saved: SavedTorrentSelection,
  stream: AddonStream,
): boolean {
  if (saved.fileIdx !== null && stream.fileIdx !== null) {
    return saved.fileIdx === stream.fileIdx;
  }

  if (saved.fileName && stream.fileName) {
    return saved.fileName === stream.fileName;
  }

  if (saved.fileIdx !== null || stream.fileIdx !== null) {
    return saved.fileIdx === stream.fileIdx;
  }

  if (saved.fileName || stream.fileName) {
    return saved.fileName === stream.fileName;
  }

  return true;
}

export function matchesSavedTorrentSelection(
  selection: SavedTorrentSelection,
  stream: AddonStream,
): boolean {
  if (
    stream.kind !== "torrent" ||
    selection.addonId !== stream.addonId ||
    !sameFileSelection(selection, stream)
  ) {
    return false;
  }

  if (selection.infoHash && stream.infoHash) {
    return selection.infoHash.toLowerCase() === stream.infoHash.toLowerCase();
  }

  return selection.url === stream.url;
}
