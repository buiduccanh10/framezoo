export interface WatchHistoryEntry {
  mediaId: string;
  type: 'movie' | 'show';
  title: string;
  poster?: string;
  watchedAt: number;
}
