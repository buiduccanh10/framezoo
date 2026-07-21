import { useCallback, useEffect, useRef } from "react";

import {
  progressUpdateItemToInput,
  removeProgress,
  setProgress,
} from "@/backend/accounts/progress";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { AccountWithToken, useAuthStore } from "@/stores/auth";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { ProgressUpdateItem, useProgressStore } from "@/stores/progress";

const HEARTBEAT_SYNC_INTERVAL_MS = 30 * 1000;
const BACKGROUND_SYNC_DELAY_MS = 300;

type CoalescedProgressUpdate = {
  item: ProgressUpdateItem;
  consumedIds: string[];
};

function getProgressQueueKey(item: ProgressUpdateItem) {
  return [item.tmdbId, item.seasonId ?? "", item.episodeId ?? ""].join("::");
}

function coalesceProgressUpdates(
  items: ProgressUpdateItem[],
): CoalescedProgressUpdate[] {
  const coalesced = new Map<string, CoalescedProgressUpdate>();

  items.forEach((item) => {
    const key = getProgressQueueKey(item);
    const existing = coalesced.get(key);

    if (existing) {
      existing.item = item;
      existing.consumedIds.push(item.id);
      return;
    }

    coalesced.set(key, {
      item,
      consumedIds: [item.id],
    });
  });

  return Array.from(coalesced.values());
}

async function syncProgress(
  entries: CoalescedProgressUpdate[],
  finish: (ids: string[]) => void,
  url: string,
  account: AccountWithToken | null,
  keepalive = false,
) {
  if (!account) {
    finish(entries.flatMap((entry) => entry.consumedIds));
    return;
  }

  for (const entry of entries) {
    const { item, consumedIds } = entry;

    try {
      if (item.action === "delete") {
        await removeProgress(
          url,
          account,
          item.tmdbId,
          item.episodeId,
          item.seasonId,
          { keepalive },
        );
        finish(consumedIds);
        continue;
      }

      if (item.action === "upsert") {
        await setProgress(url, account, progressUpdateItemToInput(item), {
          keepalive,
        });
        finish(consumedIds);
      }
    } catch (err) {
      console.error(
        `Failed to sync progress: ${item.tmdbId} - ${item.action}`,
        err,
      );
    }
  }
}

export function ProgressSyncer() {
  const clearUpdateQueue = useProgressStore((s) => s.clearUpdateQueue);
  const removeUpdateItems = useProgressStore((s) => s.removeUpdateItems);
  const queueLength = useProgressStore((s) => s.updateQueue.length);
  const status = usePlayerStore((s) => s.status);
  const isPlaying = usePlayerStore((s) => s.mediaPlaying.isPlaying);
  const isSeeking = usePlayerStore((s) => s.interface.isSeeking);
  const url = useBackendUrl();

  const backgroundSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const needsAnotherPassRef = useRef(false);
  const queuedKeepaliveRef = useRef(false);
  const previousStateRef = useRef({
    status,
    isPlaying,
    isSeeking,
  });

  // when booting for the first time, clear update queue.
  // we dont want to process persisted update items
  useEffect(() => {
    clearUpdateQueue();
  }, [clearUpdateQueue]);

  const flushProgressQueue = useCallback(
    async (options?: { keepalive?: boolean }) => {
      if (!url) return;

      const keepalive = options?.keepalive ?? false;
      if (keepalive) {
        queuedKeepaliveRef.current = true;
      }

      if (inFlightRef.current) {
        needsAnotherPassRef.current = true;
        return inFlightRef.current;
      }

      inFlightRef.current = (async () => {
        do {
          needsAnotherPassRef.current = false;
          const shouldUseKeepalive = queuedKeepaliveRef.current;
          queuedKeepaliveRef.current = false;

          const state = useProgressStore.getState();
          if (state.updateQueue.length === 0) continue;

          const entries = coalesceProgressUpdates(state.updateQueue);
          const account = useAuthStore.getState().account;

          await syncProgress(
            entries,
            removeUpdateItems,
            url,
            account,
            shouldUseKeepalive,
          );
        } while (queuedKeepaliveRef.current || needsAnotherPassRef.current);
      })().finally(() => {
        inFlightRef.current = null;
      });

      return inFlightRef.current;
    },
    [removeUpdateItems, url],
  );

  // Sync non-player-triggered changes quickly, but avoid per-tick sync while media is actively playing.
  useEffect(() => {
    if (!url || queueLength === 0) return;
    if (status === playerStatus.PLAYING && isPlaying) return;

    if (backgroundSyncTimeoutRef.current) {
      clearTimeout(backgroundSyncTimeoutRef.current);
    }

    backgroundSyncTimeoutRef.current = setTimeout(() => {
      void flushProgressQueue();
    }, BACKGROUND_SYNC_DELAY_MS);

    return () => {
      if (backgroundSyncTimeoutRef.current) {
        clearTimeout(backgroundSyncTimeoutRef.current);
        backgroundSyncTimeoutRef.current = null;
      }
    };
  }, [flushProgressQueue, isPlaying, queueLength, status, url]);

  // Flush immediately on pause, seek end, or when leaving playback.
  useEffect(() => {
    const previousState = previousStateRef.current;
    const leftPlayback =
      previousState.status === playerStatus.PLAYING &&
      status !== playerStatus.PLAYING;
    const pausedPlayback = previousState.isPlaying && !isPlaying;
    const finishedSeeking = previousState.isSeeking && !isSeeking;

    previousStateRef.current = {
      status,
      isPlaying,
      isSeeking,
    };

    if (queueLength === 0) return;
    if (leftPlayback || pausedPlayback || finishedSeeking) {
      void flushProgressQueue();
    }
  }, [flushProgressQueue, isPlaying, isSeeking, queueLength, status]);

  // Heartbeat sync while actively playing to avoid losing too much progress on abrupt closes.
  useEffect(() => {
    if (status !== playerStatus.PLAYING || !isPlaying) return;

    const interval = setInterval(() => {
      if (useProgressStore.getState().updateQueue.length === 0) return;
      void flushProgressQueue();
    }, HEARTBEAT_SYNC_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [flushProgressQueue, isPlaying, status]);

  // Keepalive flush for tab hide / unload.
  useEffect(() => {
    const flushWithKeepalive = () => {
      if (useProgressStore.getState().updateQueue.length === 0) return;
      void flushProgressQueue({ keepalive: true });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushWithKeepalive();
      }
    };

    window.addEventListener("pagehide", flushWithKeepalive);
    window.addEventListener("beforeunload", flushWithKeepalive);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flushWithKeepalive);
      window.removeEventListener("beforeunload", flushWithKeepalive);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [flushProgressQueue]);

  return null;
}
