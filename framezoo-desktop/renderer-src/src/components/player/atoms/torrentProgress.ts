export function getTorrentPreloadedProgress(
  bufferedSeconds: number,
  durationSeconds: number,
  torrentProgressPercent: number,
) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;

  const bufferedProgress =
    Number.isFinite(bufferedSeconds) && bufferedSeconds > 0
      ? bufferedSeconds / durationSeconds
      : 0;
  const torrentProgress =
    Number.isFinite(torrentProgressPercent) && torrentProgressPercent > 0
      ? torrentProgressPercent / 100
      : 0;

  return Math.min(1, Math.max(0, bufferedProgress, torrentProgress));
}
