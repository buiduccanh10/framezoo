import type { TorrentStatus } from "./torrentTypes";

export function acceptsTorrentStatus(
  activeSessionId: string | null,
  status: TorrentStatus,
) {
  return activeSessionId === status.sessionId;
}

export function normalizeTorrentProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, progress));
}

export function mergeTorrentStatus(
  previous: TorrentStatus | null,
  next: TorrentStatus,
) {
  if (!acceptsTorrentStatus(previous?.sessionId ?? null, next)) {
    return previous;
  }
  return {
    ...next,
    progress: normalizeTorrentProgress(next.progress),
  };
}
