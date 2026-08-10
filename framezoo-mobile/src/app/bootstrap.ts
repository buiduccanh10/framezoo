import { DEFAULT_CONFIG } from '@/types/config';

import { mobileStorage } from '@/services/storage/storage';
import { useAuthStore } from '@/state/auth/store';
import { usePreferencesStore } from '@/state/preferences/store';
import { useSubtitleStore } from '@/state/subtitles/store';
import { useThemeStore } from '@/state/theme/store';

const AUTH_KEY = '@framezoo/mobile/auth';
const BACKEND_KEY = '@framezoo/mobile/backend';
const PREFERENCES_KEY = '@framezoo/mobile/preferences';

interface PersistedPreferences {
  autoplay?: boolean;
  skipCredits?: boolean;
  autoSkipSegments?: boolean;
  autoResumeOnPlaybackError?: boolean;
  enableDoubleClickToSeek?: boolean;
  proxyTmdb?: boolean;
  torrentMaxSizeBytes?: string;
  language?: string;
  theme?: string;
  subtitleLanguage?: string;
  subtitleFontSize?: number;
  subtitleDelayMs?: number;
}

export async function bootstrap() {
  const [auth, backendUrl, preferences] = await Promise.all([
    mobileStorage.getJson<ReturnType<typeof useAuthStore.getState>>(AUTH_KEY),
    mobileStorage.get(BACKEND_KEY),
    mobileStorage.getJson<PersistedPreferences>(PREFERENCES_KEY),
  ]);

  if (auth?.account) useAuthStore.getState().setAccount(auth.account);
  useAuthStore.getState().setBackendUrl(backendUrl ?? DEFAULT_CONFIG.backendUrl);
  if (preferences) {
    const current = usePreferencesStore.getState();
    if (typeof preferences.autoplay === 'boolean') current.setAutoplay(preferences.autoplay);
    if (typeof preferences.skipCredits === 'boolean') current.setSkipCredits(preferences.skipCredits);
    if (typeof preferences.autoSkipSegments === 'boolean') current.setAutoSkipSegments(preferences.autoSkipSegments);
    if (typeof preferences.autoResumeOnPlaybackError === 'boolean') {
      current.setAutoResumeOnPlaybackError(preferences.autoResumeOnPlaybackError);
    }
    if (typeof preferences.enableDoubleClickToSeek === 'boolean') {
      current.setEnableDoubleClickToSeek(preferences.enableDoubleClickToSeek);
    }
    if (typeof preferences.proxyTmdb === 'boolean') current.setProxyTmdb(preferences.proxyTmdb);
    if (preferences.torrentMaxSizeBytes) current.setTorrentMaxSizeBytes(preferences.torrentMaxSizeBytes);
    if (preferences.language) current.setLanguage(preferences.language);
    if (preferences.theme) {
      current.setTheme(preferences.theme);
      useThemeStore.getState().setThemeId(preferences.theme);
    }
    if (preferences.subtitleLanguage) {
      useSubtitleStore.getState().setLanguage(preferences.subtitleLanguage);
    }
    if (typeof preferences.subtitleFontSize === 'number') {
      useSubtitleStore.getState().setFontSize(preferences.subtitleFontSize);
    }
    if (typeof preferences.subtitleDelayMs === 'number') {
      useSubtitleStore.getState().setDelayMs(preferences.subtitleDelayMs);
    }
  }
  useAuthStore.getState().setHydrated(true);
}

export function persistAuth() {
  return mobileStorage.setJson(AUTH_KEY, {
    account: useAuthStore.getState().account,
  });
}

export function persistBackendUrl() {
  return mobileStorage.set(BACKEND_KEY, useAuthStore.getState().backendUrl);
}

export function persistPreferences() {
  const state = usePreferencesStore.getState();
  const subtitles = useSubtitleStore.getState();
  return mobileStorage.setJson(PREFERENCES_KEY, {
    autoplay: state.autoplay,
    skipCredits: state.skipCredits,
    autoSkipSegments: state.autoSkipSegments,
    autoResumeOnPlaybackError: state.autoResumeOnPlaybackError,
    language: state.language,
    theme: state.theme,
    subtitleLanguage: subtitles.language,
    subtitleFontSize: subtitles.fontSize,
    subtitleDelayMs: subtitles.delayMs,
    enableDoubleClickToSeek: state.enableDoubleClickToSeek,
    proxyTmdb: state.proxyTmdb,
    torrentMaxSizeBytes: state.torrentMaxSizeBytes,
  });
}
