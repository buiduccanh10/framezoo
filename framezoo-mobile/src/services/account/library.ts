import type { AccountWithToken } from '@/types';

import { apiRequest } from '../api/client';
import type { BookmarkEntry } from '../bookmarks';
import type { ProgressEntry } from '../progress';
import type { WatchHistoryEntry } from '../watchHistory';

interface BookmarkResponse {
  tmdbId: string;
  meta: { title: string; year?: number; poster?: string; type: 'movie' | 'show' };
  updatedAt: string;
}

interface ProgressResponse {
  tmdbId: string;
  season?: { number?: number };
  episode?: { number?: number };
  meta: { title: string; poster?: string; type: 'movie' | 'show' };
  duration: string | number;
  watched: string | number;
  updatedAt: string;
}

interface WatchHistoryResponse {
  tmdbId: string;
  season?: { number?: number };
  episode?: { number?: number };
  meta: { title: string; poster?: string; type: 'movie' | 'show' };
  watchedAt: string;
}

export async function loadLibrary(baseUrl: string, account: AccountWithToken) {
  const [bookmarks, progress, history] = await Promise.all([
    apiRequest<BookmarkResponse[]>(
      baseUrl,
      `/users/${encodeURIComponent(account.userId)}/bookmarks`,
      { account },
    ),
    apiRequest<ProgressResponse[]>(
      baseUrl,
      `/users/${encodeURIComponent(account.userId)}/progress`,
      { account },
    ),
    apiRequest<WatchHistoryResponse[]>(
      baseUrl,
      `/users/${encodeURIComponent(account.userId)}/watch-history`,
      { account },
    ),
  ]);

  return {
    bookmarks: bookmarks.map<BookmarkEntry>((item) => ({
      mediaId: item.tmdbId,
      type: item.meta.type,
      title: item.meta.title,
      poster: item.meta.poster,
      createdAt: Date.parse(item.updatedAt) || Date.now(),
    })),
    progress: progress.map<ProgressEntry>((item) => ({
      mediaId: item.tmdbId,
      type: item.meta.type,
      title: item.meta.title,
      poster: item.meta.poster,
      season: item.season?.number,
      episode: item.episode?.number,
      position: Number(item.watched),
      duration: Number(item.duration),
      updatedAt: Date.parse(item.updatedAt) || Date.now(),
    })),
    history: history.map<WatchHistoryEntry>((item) => ({
      mediaId: item.tmdbId,
      type: item.meta.type,
      title: item.meta.title,
      poster: item.meta.poster,
      watchedAt: Date.parse(item.watchedAt) || Date.now(),
    })),
  };
}

export function saveBookmark(
  baseUrl: string,
  account: AccountWithToken,
  entry: BookmarkEntry,
) {
  return apiRequest<unknown>(
    baseUrl,
    `/users/${encodeURIComponent(account.userId)}/bookmarks/${encodeURIComponent(entry.mediaId)}`,
    {
      method: 'POST',
      account,
      body: JSON.stringify({
        tmdbId: entry.mediaId,
        meta: {
          title: entry.title,
          type: entry.type,
          poster: entry.poster,
          year: 0,
        },
      }),
    },
  );
}

export function deleteBookmark(
  baseUrl: string,
  account: AccountWithToken,
  mediaId: string,
) {
  return apiRequest<unknown>(
    baseUrl,
    `/users/${encodeURIComponent(account.userId)}/bookmarks/${encodeURIComponent(mediaId)}`,
    { method: 'DELETE', account },
  );
}
