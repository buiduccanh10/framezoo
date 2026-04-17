import { ofetch } from "ofetch";

import { getAuthHeaders } from "@/backend/accounts/auth";
import { AccountWithToken } from "@/stores/auth";

import { BookmarkInput } from "./bookmarks";
import { ProgressInput } from "./progress";
import { SettingsInput } from "./settings";
import { WatchHistoryInput } from "./watchHistory";

export function importProgress(
  url: string,
  account: AccountWithToken,
  progressItems: ProgressInput[],
) {
  return ofetch<void>(`/users/${account.userId}/progress/import`, {
    method: "PUT",
    credentials: "include",
    body: progressItems,
    baseURL: url,
    headers: getAuthHeaders(account.token),
  });
}

export function importBookmarks(
  url: string,
  account: AccountWithToken,
  bookmarks: BookmarkInput[],
) {
  return ofetch<void>(`/users/${account.userId}/bookmarks`, {
    method: "PUT",
    credentials: "include",
    body: bookmarks,
    baseURL: url,
    headers: getAuthHeaders(account.token),
  });
}

export function importGroupOrder(
  url: string,
  account: AccountWithToken,
  groupOrder: string[],
) {
  return ofetch<void>(`/users/${account.userId}/group-order`, {
    method: "PUT",
    credentials: "include",
    body: groupOrder,
    baseURL: url,
    headers: getAuthHeaders(account.token),
  });
}

export function importWatchHistory(
  url: string,
  account: AccountWithToken,
  watchHistoryItems: WatchHistoryInput[],
) {
  return ofetch<void>(`/users/${account.userId}/watch-history/import`, {
    method: "PUT",
    credentials: "include",
    body: watchHistoryItems,
    baseURL: url,
    headers: getAuthHeaders(account.token),
  });
}

export function importSettings(
  url: string,
  account: AccountWithToken,
  settings: SettingsInput,
) {
  return ofetch<void>(`/users/${account.userId}/settings`, {
    method: "PUT",
    credentials: "include",
    body: settings,
    baseURL: url,
    headers: getAuthHeaders(account.token),
  });
}
