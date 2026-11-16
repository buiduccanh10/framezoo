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
const TORRENT_REPLACED_STOP_GRACE_MS = 15_000;
const STATUS_THROTTLE_MS = 500;

let pendingStatus: TorrentStatus | null = null;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;
let lastPublishedAt = 0;

function publish() {
  for (const listener of listeners) listener();
}

function resetStatusThrottle() {
  if (throttleTimer) {
    clearTimeout(throttleTimer);
    throttleTimer = null;
  }
  pendingStatus = null;
  lastPublishedAt = 0;
}

function isUrgentStatus(status: TorrentStatus): boolean {
  return (
    status.streamType !== activeStatus?.streamType ||
    status.state !== activeStatus?.state ||
    Boolean(status.error) !== Boolean(activeStatus?.error)
  );
}

function commitStatus(status: TorrentStatus) {
  activeStatus = status;
  lastPublishedAt = Date.now();
  publish();
}

function handleIncomingStatus(status: TorrentStatus) {
  if (status.sessionId !== activeSessionId) return;
  const elapsed = Date.now() - lastPublishedAt;
  if (isUrgentStatus(status) || elapsed >= STATUS_THROTTLE_MS) {
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    pendingStatus = null;
    commitStatus(status);
    return;
  }
  pendingStatus = status;
  if (!throttleTimer) {
    throttleTimer = setTimeout(
      () => {
        throttleTimer = null;
        const next = pendingStatus;
        pendingStatus = null;
        if (next && next.sessionId === activeSessionId) {
          commitStatus(next);
        }
      },
      Math.max(0, STATUS_THROTTLE_MS - elapsed),
    );
  }
}

function ensureSubscription() {
  if (unsubscribe) return;
  unsubscribe = subscribeTorrentStatus(handleIncomingStatus);
}

export function registerTorrentSession(sessionId: string) {
  ensureSubscription();
  const previousSessionId =
    activeSessionId && activeSessionId !== sessionId ? activeSessionId : null;
  const pendingStop = pendingStopTimers.get(sessionId);
  if (pendingStop) {
    clearTimeout(pendingStop);
    pendingStopTimers.delete(sessionId);
  }
  activeSessionId = sessionId;
  activeStatus = null;
  resetStatusThrottle();
  publish();
  if (previousSessionId && !pendingStopTimers.has(previousSessionId)) {
    scheduleTorrentStop(previousSessionId, TORRENT_REPLACED_STOP_GRACE_MS);
  }
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
  resetStatusThrottle();
  publish();
  if (currentSessionId) scheduleTorrentStop(currentSessionId);
}

export function clearActiveTorrentSession() {
  const currentSessionId = activeSessionId;
  activeSessionId = null;
  activeStatus = null;
  resetStatusThrottle();
  publish();
  if (currentSessionId) scheduleTorrentStop(currentSessionId);
}

export async function stopTorrentSession(sessionId?: string) {
  if (sessionId) {
    const pendingStop = pendingStopTimers.get(sessionId);
    if (pendingStop) {
      clearTimeout(pendingStop);
      pendingStopTimers.delete(sessionId);
    }
    if (activeSessionId === sessionId) {
      activeSessionId = null;
      activeStatus = null;
      resetStatusThrottle();
      publish();
    }
    await stopTorrent(sessionId).catch((error) => {
      console.warn("Failed to stop torrent session", sessionId, error);
    });
    return;
  }

  const currentSessionId = activeSessionId;
  const sessionIds = new Set<string>(Array.from(pendingStopTimers.keys()));
  if (currentSessionId) sessionIds.add(currentSessionId);
  activeSessionId = null;
  activeStatus = null;
  resetStatusThrottle();
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
    inspect(activeStatus);
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
