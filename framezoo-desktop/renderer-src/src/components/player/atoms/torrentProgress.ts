export function getTorrentPreloadedProgress(
  bufferedSeconds: number,
  durationSeconds: number,
  _torrentProgressPercent: number,
) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;

  const bufferedProgress =
    Number.isFinite(bufferedSeconds) && bufferedSeconds > 0
      ? bufferedSeconds / durationSeconds
      : 0;

  // We intentionally ignore torrentProgressPercent here because showing overall
  // torrent download percentage on the media progress bar implies to the user
  // that the video is sequentially buffered and seekable instantly, which is false
  // for out-of-order torrent downloads.
  return Math.min(1, Math.max(0, bufferedProgress));
}
