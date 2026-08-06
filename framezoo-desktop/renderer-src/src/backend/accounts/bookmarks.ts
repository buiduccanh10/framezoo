import { ofetch } from "ofetch";

import { getAuthHeaders, withAuthRetry } from "@/backend/accounts/auth";
import { BookmarkResponse } from "@/backend/accounts/user";
import { AccountWithToken } from "@/stores/auth";
import { BookmarkMediaItem } from "@/stores/bookmarks";

export interface BookmarkMetaInput {
  title: string;
  year: number;
  poster?: string;
  type: string;
}

export interface BookmarkInput {
  tmdbId: string;
  meta: BookmarkMetaInput;
  group?: string[];
  favoriteEpisodes?: string[];
}

export function bookmarkMediaToInput(
  tmdbId: string,
  item: BookmarkMediaItem,
): BookmarkInput {
  return {
    meta: {
      title: item.title,
      type: item.type,
      poster: item.poster,
      year: item.year ?? 0,
    },
    tmdbId,
    group: item.group,
    favoriteEpisodes: item.favoriteEpisodes,
  };
}

export async function addBookmark(
  url: string,
  account: AccountWithToken,
  input: BookmarkInput,
) {
  return withAuthRetry(url, account, (token) =>
    ofetch<BookmarkResponse>(
      `/users/${account.userId}/bookmarks/${input.tmdbId}`,
      {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(token),
        baseURL: url,
        body: input,
      },
    ),
  );
}

export async function removeBookmark(
  url: string,
  account: AccountWithToken,
  id: string,
) {
  return withAuthRetry(url, account, (token) =>
    ofetch<{ tmdbId: string }>(`/users/${account.userId}/bookmarks/${id}`, {
      method: "DELETE",
      credentials: "include",
      headers: getAuthHeaders(token),
      baseURL: url,
    }),
  );
}
