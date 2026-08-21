import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import {
  clearAllPlaybackStorage,
  clearMediaPlaybackStorage,
} from "@/desktop/addons/playbackStorage";
import { PlayerMeta } from "@/stores/player/slices/source";
import { useWatchHistoryStore } from "@/stores/watchHistory";
import {
  ProgressModificationOptions,
  ProgressModificationResult,
  modifyProgressItems,
} from "@/utils/progressModifications";

export { getProgressPercentage } from "./utils";

export interface ProgressItem {
  watched: number;
  duration: number;
}

export interface ProgressSeasonItem {
  title: string;
  number: number;
  id: string;
}

export interface ProgressEpisodeItem {
  title: string;
  number: number;
  id: string;
  seasonId: string;
  updatedAt: number;
  progress: ProgressItem;
}

export interface ProgressMediaItem {
  title: string;
  year?: number;
  poster?: string;
  type: "show" | "movie";
  progress?: ProgressItem;
  updatedAt: number;
  seasons: Record<string, ProgressSeasonItem>;
  episodes: Record<string, ProgressEpisodeItem>;
}

export interface ProgressUpdateItem {
  title?: string;
  year?: number;
  poster?: string;
  type?: "show" | "movie";
  progress?: ProgressItem;
  updatedAt?: number;
  tmdbId: string;
  id: string;
  episodeId?: string;
  seasonId?: string;
  episodeNumber?: number;
  seasonNumber?: number;
  action: "upsert" | "delete";
}

export interface UpdateItemOptions {
  meta: PlayerMeta;
  progress: ProgressItem;
}

export interface ProgressStore {
  items: Record<string, ProgressMediaItem>;
  updateQueue: ProgressUpdateItem[];
  updateItem(ops: UpdateItemOptions): void;
  removeItem(id: string): void;
  replaceItems(items: Record<string, ProgressMediaItem>): void;
  modifyProgressItems(
    progressIds: string[],
    options: ProgressModificationOptions,
  ): ProgressModificationResult;
  clear(): void;
  clearUpdateQueue(): void;
  removeUpdateItem(id: string): void;
  removeUpdateItems(ids: string[]): void;
}

let updateId = 0;
const WATCH_HISTORY_THRESHOLD = 0.2;
const WATCH_HISTORY_COMPLETED_THRESHOLD = 0.9;

function getProgressRatio(progress: ProgressItem): number {
  if (progress.duration <= 0) return 0;
  return progress.watched / progress.duration;
}

function hasReachedWatchHistoryThreshold(progress: ProgressItem): boolean {
  return getProgressRatio(progress) > WATCH_HISTORY_THRESHOLD;
}

function hasCompletedWatchHistoryItem(progress: ProgressItem): boolean {
  return getProgressRatio(progress) > WATCH_HISTORY_COMPLETED_THRESHOLD;
}

export const useProgressStore = create(
  persist(
    immer<ProgressStore>((set) => ({
      items: {},
      updateQueue: [],
      removeItem(id) {
        clearMediaPlaybackStorage(id);
        set((s) => {
          updateId += 1;
          s.updateQueue.push({
            id: updateId.toString(),
            action: "delete",
            tmdbId: id,
          });

          delete s.items[id];
        });
      },
      replaceItems(items: Record<string, ProgressMediaItem>) {
        set((s) => {
          s.items = items;
        });
      },
      updateItem({ meta, progress }) {
        set((s) => {
          const now = Date.now();
          // add to updateQueue
          updateId += 1;
          s.updateQueue.push({
            tmdbId: meta.tmdbId,
            title: meta.title,
            year: meta.releaseYear,
            poster: meta.poster,
            type: meta.type,
            progress: { ...progress },
            updatedAt: now,
            id: updateId.toString(),
            episodeId: meta.episode?.tmdbId,
            seasonId: meta.season?.tmdbId,
            seasonNumber: meta.season?.number,
            episodeNumber: meta.episode?.number,
            action: "upsert",
          });

          // add to progress store
          if (!s.items[meta.tmdbId])
            s.items[meta.tmdbId] = {
              type: meta.type,
              episodes: {},
              seasons: {},
              updatedAt: 0,
              title: meta.title,
              year: meta.releaseYear,
              poster: meta.poster,
            };
          const item = s.items[meta.tmdbId];
          item.updatedAt = now;

          if (meta.type === "movie") {
            if (!item.progress)
              item.progress = {
                duration: 0,
                watched: 0,
              };

            const previousProgress = item.progress;
            const wasInWatchHistory =
              hasReachedWatchHistoryThreshold(previousProgress);
            const wasCompleted = hasCompletedWatchHistoryItem(previousProgress);
            item.progress = { ...progress };

            const isInWatchHistory = hasReachedWatchHistoryThreshold(progress);
            const isCompleted = hasCompletedWatchHistoryItem(progress);

            // Add items to watch history once they pass the minimum watch threshold,
            // and upgrade existing history entries to completed later if needed.
            if (isInWatchHistory && (!wasInWatchHistory || !wasCompleted)) {
              useWatchHistoryStore
                .getState()
                .addItem(meta, progress, isCompleted);
            }
            return;
          }

          if (!meta.episode || !meta.season) return;

          if (!item.seasons[meta.season.tmdbId])
            item.seasons[meta.season.tmdbId] = {
              id: meta.season.tmdbId,
              number: meta.season.number,
              title: meta.season.title,
            };

          if (!item.episodes[meta.episode.tmdbId])
            item.episodes[meta.episode.tmdbId] = {
              id: meta.episode.tmdbId,
              number: meta.episode.number,
              title: meta.episode.title,
              seasonId: meta.season.tmdbId,
              updatedAt: Date.now(),
              progress: {
                duration: 0,
                watched: 0,
              },
            };

          const episodeItem = item.episodes[meta.episode.tmdbId];
          const previousProgress = episodeItem.progress;
          const wasInWatchHistory =
            hasReachedWatchHistoryThreshold(previousProgress);
          const wasCompleted = hasCompletedWatchHistoryItem(previousProgress);
          episodeItem.progress = { ...progress };
          episodeItem.updatedAt = now;

          const isInWatchHistory = hasReachedWatchHistoryThreshold(progress);
          const isCompleted = hasCompletedWatchHistoryItem(progress);
          if (isInWatchHistory && (!wasInWatchHistory || !wasCompleted)) {
            useWatchHistoryStore
              .getState()
              .addItem(meta, progress, isCompleted);
          }
        });
      },
      clear() {
        clearAllPlaybackStorage();
        set((s) => {
          s.items = {};
        });
      },
      clearUpdateQueue() {
        set((s) => {
          s.updateQueue = [];
        });
      },
      removeUpdateItem(id: string) {
        set((s) => {
          s.updateQueue = [...s.updateQueue.filter((v) => v.id !== id)];
        });
      },
      removeUpdateItems(ids: string[]) {
        if (ids.length === 0) return;

        const queuedIds = new Set(ids);
        set((s) => {
          s.updateQueue = s.updateQueue.filter((v) => !queuedIds.has(v.id));
        });
      },
      modifyProgressItems(
        progressIds: string[],
        options: ProgressModificationOptions,
      ): ProgressModificationResult {
        let result: ProgressModificationResult = {
          modifiedIds: [],
          hasChanges: false,
        };

        set((s) => {
          const { modifiedProgressItems, result: modificationResult } =
            modifyProgressItems(s.items, progressIds, options);
          s.items = modifiedProgressItems;
          result = modificationResult;

          // Add to update queue for modified progress items
          if (result.hasChanges) {
            result.modifiedIds.forEach((progressId) => {
              const progressItem = s.items[progressId];
              if (progressItem) {
                updateId += 1;
                s.updateQueue.push({
                  id: updateId.toString(),
                  action: "upsert",
                  tmdbId: progressId,
                  title: progressItem.title,
                  year: progressItem.year,
                  poster: progressItem.poster,
                  type: progressItem.type,
                  progress: progressItem.progress,
                  updatedAt: progressItem.updatedAt,
                });
              }
            });
          }
        });

        return result;
      },
    })),
    {
      name: "__MW::progress",
    },
  ),
);
