export interface ProgressEntry {
  mediaId: string;
  type: 'movie' | 'show';
  title?: string;
  poster?: string;
  year?: number;
  season?: number;
  episode?: number;
  position: number;
  duration: number;
  updatedAt: number;
}
