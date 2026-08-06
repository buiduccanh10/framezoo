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

export function getActiveTorrentStatus() {
  return activeStatus;
}

export function getActiveTorrentSessionId() {
  return activeSessionId;
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
