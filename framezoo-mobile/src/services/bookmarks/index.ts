export interface BookmarkEntry {
  mediaId: string;
  type: 'movie' | 'show';
  title: string;
  poster?: string;
  createdAt: number;
}
