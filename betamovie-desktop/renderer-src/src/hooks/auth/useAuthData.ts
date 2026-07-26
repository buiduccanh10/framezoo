import { useCallback } from "react";

import {
  LoginResponse,
  SessionResponse,
  normalizeAccessToken,
  normalizeRefreshToken,
} from "@/backend/accounts/auth";
import { SettingsResponse } from "@/backend/accounts/settings";
import {
  BookmarkResponse,
  ProgressResponse,
  UserResponse,
  WatchHistoryResponse,
  bookmarkResponsesToEntries,
  progressResponsesToEntries,
  watchHistoryResponsesToEntries,
} from "@/backend/accounts/user";
import { useAuthStore } from "@/stores/auth";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useGroupOrderStore } from "@/stores/groupOrder";
import { useLanguageStore } from "@/stores/language";
import { usePreferencesStore } from "@/stores/preferences";
import { useProgressStore } from "@/stores/progress";
import { useSubtitleStore } from "@/stores/subtitles";
import { useThemeStore } from "@/stores/theme";
import { useWatchHistoryStore } from "@/stores/watchHistory";

export function useAuthData() {
  const loggedIn = !!useAuthStore((s) => s.account);
  const setAccount = useAuthStore((s) => s.setAccount);
  const removeAccount = useAuthStore((s) => s.removeAccount);
  const setProxySet = useAuthStore((s) => s.setProxySet);
  const clearBookmarks = useBookmarkStore((s) => s.clear);
  const clearProgress = useProgressStore((s) => s.clear);
  const clearWatchHistory = useWatchHistoryStore((s) => s.clear);
  const clearGroupOrder = useGroupOrderStore((s) => s.clear);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setAppLanguage = useLanguageStore((s) => s.setLanguage);
  const importSubtitleLanguage = useSubtitleStore(
    (s) => s.importSubtitleLanguage,
  );
  const setFebboxKey = usePreferencesStore((s) => s.setFebboxKey);
  const setdebridToken = usePreferencesStore((s) => s.setdebridToken);
  const setdebridService = usePreferencesStore((s) => s.setdebridService);

  const replaceBookmarks = useBookmarkStore((s) => s.replaceBookmarks);
  const replaceItems = useProgressStore((s) => s.replaceItems);
  const replaceWatchHistory = useWatchHistoryStore((s) => s.replaceItems);

  const setEnableAutoplay = usePreferencesStore((s) => s.setEnableAutoplay);
  const setEnableSkipCredits = usePreferencesStore(
    (s) => s.setEnableSkipCredits,
  );

  const setEmbedOrder = usePreferencesStore((s) => s.setEmbedOrder);
  const setEnableEmbedOrder = usePreferencesStore((s) => s.setEnableEmbedOrder);

  const setProxyTmdb = usePreferencesStore((s) => s.setProxyTmdb);
  const setEnableDoubleClickToSeek = usePreferencesStore(
    (s) => s.setEnableDoubleClickToSeek,
  );
  const setManualSourceSelection = usePreferencesStore(
    (s) => s.setManualSourceSelection,
  );
  const setEnableAutoResumeOnPlaybackError = usePreferencesStore(
    (s) => s.setEnableAutoResumeOnPlaybackError,
  );
  const setEnableNumberKeySeeking = usePreferencesStore(
    (s) => s.setEnableNumberKeySeeking,
  );
  const setKeyboardShortcuts = usePreferencesStore(
    (s) => s.setKeyboardShortcuts,
  );

  const login = useCallback(
    async (
      loginResponse: LoginResponse,
      user: UserResponse,
      session: SessionResponse,
      seed: string,
    ) => {
      const accessToken = normalizeAccessToken(loginResponse.oauth);
      const refreshToken = normalizeRefreshToken(loginResponse.oauth);
      const account = {
        userId: user.id,
        sessionId: loginResponse.session.id,
        deviceName: session.device,
        profile: user.profile,
        nickname: user.nickname,
        token: accessToken,
        refreshToken,
        seed,
      };
      setAccount(account);
      return account;
    },
    [setAccount],
  );

  const logout = useCallback(async () => {
    removeAccount();
    clearBookmarks();
    clearProgress();
    clearWatchHistory();
    clearGroupOrder();
    setFebboxKey(null);
  }, [
    removeAccount,
    clearBookmarks,
    clearProgress,
    clearWatchHistory,
    clearGroupOrder,
    setFebboxKey,
  ]);

  const syncData = useCallback(
    async (
      _user: UserResponse,
      _session: SessionResponse,
      progress: ProgressResponse[],
      bookmarks: BookmarkResponse[],
      watchHistory: WatchHistoryResponse[],
      settings: SettingsResponse,
      groupOrder: { groupOrder: string[] },
    ) => {
      replaceBookmarks(bookmarkResponsesToEntries(bookmarks));
      replaceItems(progressResponsesToEntries(progress));
      replaceWatchHistory(watchHistoryResponsesToEntries(watchHistory));

      if (groupOrder?.groupOrder) {
        useGroupOrderStore.getState().setGroupOrder(groupOrder.groupOrder);
      }

      if (settings.applicationLanguage) {
        setAppLanguage(settings.applicationLanguage);
      }

      if (settings.defaultSubtitleLanguage) {
        importSubtitleLanguage(settings.defaultSubtitleLanguage);
      }

      if (settings.applicationTheme) {
        setTheme(settings.applicationTheme);
      }

      if (settings.proxyUrls) {
        setProxySet(settings.proxyUrls);
      }

      if (settings.enableAutoplay !== undefined) {
        setEnableAutoplay(settings.enableAutoplay);
      }

      if (settings.enableSkipCredits !== undefined) {
        setEnableSkipCredits(settings.enableSkipCredits);
      }

      if (settings.embedOrder !== undefined) {
        setEmbedOrder(settings.embedOrder ?? []);
      }

      if (settings.enableEmbedOrder !== undefined) {
        setEnableEmbedOrder(settings.enableEmbedOrder);
      }

      if (settings.proxyTmdb !== undefined) {
        setProxyTmdb(settings.proxyTmdb);
      }

      if (settings.febboxKey !== undefined) {
        setFebboxKey(settings.febboxKey);
      }

      if (settings.debridToken !== undefined) {
        setdebridToken(settings.debridToken);
      }

      if (settings.debridService !== undefined) {
        setdebridService(settings.debridService);
      }

      if (settings.manualSourceSelection !== undefined) {
        setManualSourceSelection(settings.manualSourceSelection);
      }

      if (settings.enableDoubleClickToSeek !== undefined) {
        setEnableDoubleClickToSeek(settings.enableDoubleClickToSeek);
      }

      if (settings.enableAutoResumeOnPlaybackError !== undefined) {
        setEnableAutoResumeOnPlaybackError(
          settings.enableAutoResumeOnPlaybackError,
        );
      }

      if (settings.enableNumberKeySeeking !== undefined) {
        setEnableNumberKeySeeking(settings.enableNumberKeySeeking);
      }

      if (settings.keyboardShortcuts !== undefined) {
        setKeyboardShortcuts(settings.keyboardShortcuts);
      }
    },
    [
      replaceBookmarks,
      replaceItems,
      replaceWatchHistory,
      setAppLanguage,
      importSubtitleLanguage,
      setTheme,
      setProxySet,

      setEnableAutoplay,
      setEnableSkipCredits,
      setEmbedOrder,
      setEnableEmbedOrder,
      setProxyTmdb,
      setFebboxKey,
      setdebridToken,
      setdebridService,
      setManualSourceSelection,
      setEnableDoubleClickToSeek,
      setEnableAutoResumeOnPlaybackError,
      setEnableNumberKeySeeking,
      setKeyboardShortcuts,
    ],
  );

  return {
    loggedIn,
    login,
    logout,
    syncData,
  };
}
