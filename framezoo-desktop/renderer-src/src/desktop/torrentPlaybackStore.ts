import { useSyncExternalStore } from "react";

import {
  getTorrentStatus,
  stopTorrent,
  subscribeTorrentStatus,
} from "./torrentClient";
import type { TorrentStatus } from "./torrentTypes";

let activeSessionId: string | null = null;
let activeStatus: TorrentStatus | null = null;
const listeners = new Set<() => void>();
const pendingStopTimers = new Map<string, ReturnType<typeof setTimeout>>();
let unsubscribe: (() => void) | null = null;
const TORRENT_STOP_GRACE_MS = 3_000;

function publish() {
  for (const listener of listeners) listener();
}

function ensureSubscription() {
  if (unsubscribe) return;
  unsubscribe = subscribeTorrentStatus((status) => {
    if (status.sessionId !== activeSessionId) return;
    activeStatus = status;
    publish();
  });
}

export function registerTorrentSession(sessionId: string) {
  ensureSubscription();
  const pendingStop = pendingStopTimers.get(sessionId);
  if (pendingStop) {
    clearTimeout(pendingStop);
    pendingStopTimers.delete(sessionId);
  }
  activeSessionId = sessionId;
  activeStatus = null;
  publish();
  void getTorrentStatus(sessionId).then((status) => {
    if (activeSessionId !== sessionId || !status) return;
    activeStatus = status;
    publish();
  });
}

export function scheduleTorrentStop(
  sessionId: string,
  delayMs = TORRENT_STOP_GRACE_MS,
) {
  const previousTimer = pendingStopTimers.get(sessionId);
  if (previousTimer) clearTimeout(previousTimer);

  const timer = setTimeout(() => {
    pendingStopTimers.delete(sessionId);
    void stopTorrent(sessionId).catch((error) => {
      console.warn("Failed to stop torrent session", sessionId, error);
    });
  }, delayMs);
  pendingStopTimers.set(sessionId, timer);
}

export async function clearTorrentSession(sessionId?: string) {
  if (sessionId && sessionId !== activeSessionId) return;
  const currentSessionId = activeSessionId;
  activeSessionId = null;
  activeStatus = null;
  publish();
  if (currentSessionId) scheduleTorrentStop(currentSessionId);
}

export function clearActiveTorrentSession() {
  const currentSessionId = activeSessionId;
  activeSessionId = null;
  activeStatus = null;
  publish();
  if (currentSessionId) scheduleTorrentStop(currentSessionId);
}

export async function stopTorrentSession(sessionId?: string) {
  if (sessionId && sessionId !== activeSessionId) return;
  const currentSessionId = activeSessionId;
  const sessionIds = new Set<string>(Array.from(pendingStopTimers.keys()));
  if (currentSessionId) sessionIds.add(currentSessionId);
  activeSessionId = null;
  activeStatus = null;
  publish();

  for (const id of sessionIds) {
    const pendingStop = pendingStopTimers.get(id);
    if (pendingStop) {
      clearTimeout(pendingStop);
      pendingStopTimers.delete(id);
    }
  }

  await Promise.all(
    Array.from(sessionIds, async (id) => {
      await stopTorrent(id).catch((error) => {
        console.warn("Failed to stop torrent session", id, error);
      });
    }),
  );
}

export function getActiveTorrentStatus() {
  return activeStatus;
}

export function getActiveTorrentSessionId() {
  return activeSessionId;
}

export function waitForTorrentPlayable(
  sessionId: string,
): Promise<TorrentStatus> {
  ensureSubscription();

  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribeWait: () => void = () => undefined;

    const finishResolve = (status: TorrentStatus) => {
      if (settled) return;
      settled = true;
      unsubscribeWait();
      resolve(status);
    };

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      unsubscribeWait();
      reject(error);
    };

    const inspect = (status: TorrentStatus | null) => {
      if (settled) return;
      if (activeSessionId !== sessionId) {
        finishReject(new Error("Torrent session was replaced"));
        return;
      }
      if (!status) return;
      if (status.state === "error") {
        finishReject(
          new Error(status.error || "Torrent stream failed before playback"),
        );
        return;
      }
      if (status.streamType === "file" && status.streamUrl) {
        finishResolve(status);
      }
    };

    unsubscribeWait = subscribeActiveTorrentStatus(() => {
      inspect(activeStatus);
    });
    void getTorrentStatus(sessionId)
      .then(inspect)
      .catch((error) => {
        finishReject(
          error instanceof Error
            ? error
            : new Error("Failed to read torrent status"),
        );
      });
  });
}

export function subscribeActiveTorrentStatus(listener: () => void) {
  listeners.add(listener);
  ensureSubscription();
  return () => listeners.delete(listener);
}

export function useActiveTorrentStatus() {
  return useSyncExternalStore(
    subscribeActiveTorrentStatus,
    getActiveTorrentStatus,
    getActiveTorrentStatus,
  );
}
