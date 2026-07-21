import type {
  TorrentSession,
  TorrentStartRequest,
  TorrentStatus,
} from "./torrentTypes";

export function hasTorrentBridge() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.__ALPHAFLIX_DESKTOP__) &&
    typeof window.electronAPI?.startTorrent === "function"
  );
}

export async function startTorrent(request: TorrentStartRequest) {
  if (!hasTorrentBridge()) {
    throw new Error("Torrent playback is available in the desktop app only");
  }
  return window.electronAPI!.startTorrent!(request) as Promise<TorrentSession>;
}

export async function stopTorrent(sessionId: string) {
  if (!hasTorrentBridge()) return false;
  return window.electronAPI!.stopTorrent?.(sessionId) ?? false;
}

export async function getTorrentStatus(sessionId: string) {
  if (!hasTorrentBridge()) return null;
  return window.electronAPI!.getTorrentStatus?.(sessionId) ?? null;
}

export function subscribeTorrentStatus(
  listener: (status: TorrentStatus) => void,
) {
  if (
    !hasTorrentBridge() ||
    typeof window.electronAPI?.onTorrentStatus !== "function"
  ) {
    return () => undefined;
  }
  return window.electronAPI.onTorrentStatus(listener);
}
