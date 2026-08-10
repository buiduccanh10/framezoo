import { create } from 'zustand';

import type { BookmarkEntry } from '@/services/bookmarks';
import type { ProgressEntry } from '@/services/progress';
import type { WatchHistoryEntry } from '@/services/watchHistory';

interface LibraryState {
  bookmarks: BookmarkEntry[];
  history: WatchHistoryEntry[];
  progress: ProgressEntry[];
  addBookmark: (entry: BookmarkEntry) => void;
  removeBookmark: (mediaId: string) => void;
  setBookmarks: (entries: BookmarkEntry[]) => void;
  addHistory: (entry: WatchHistoryEntry) => void;
  setHistory: (entries: WatchHistoryEntry[]) => void;
  setProgress: (entry: ProgressEntry) => void;
  setProgressEntries: (entries: ProgressEntry[]) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  bookmarks: [],
  history: [],
  progress: [],
  addBookmark: (entry) =>
    set((state) => ({
      bookmarks: [
        entry,
        ...state.bookmarks.filter((item) => item.mediaId !== entry.mediaId),
      ],
    })),
  removeBookmark: (mediaId) =>
    set((state) => ({
      bookmarks: state.bookmarks.filter((item) => item.mediaId !== mediaId),
    })),
  setBookmarks: (bookmarks) => set({ bookmarks }),
  addHistory: (entry) =>
    set((state) => ({
      history: [
        entry,
        ...state.history.filter((item) => item.mediaId !== entry.mediaId),
      ],
    })),
  setHistory: (history) => set({ history }),
  setProgress: (entry) =>
    set((state) => ({
      progress: [
        entry,
        ...state.progress.filter(
          (item) =>
            item.mediaId !== entry.mediaId ||
            item.season !== entry.season ||
            item.episode !== entry.episode,
        ),
      ],
    })),
  setProgressEntries: (progress) => set({ progress }),
}));
