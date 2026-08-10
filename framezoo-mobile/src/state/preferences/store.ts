import { create } from 'zustand';

interface PreferencesState {
  autoplay: boolean;
  skipCredits: boolean;
  autoSkipSegments: boolean;
  autoResumeOnPlaybackError: boolean;
  enableDoubleClickToSeek: boolean;
  proxyTmdb: boolean;
  torrentMaxSizeBytes: string;
  language: string;
  theme: string;
  setAutoplay: (value: boolean) => void;
  setSkipCredits: (value: boolean) => void;
  setAutoSkipSegments: (value: boolean) => void;
  setAutoResumeOnPlaybackError: (value: boolean) => void;
  setEnableDoubleClickToSeek: (value: boolean) => void;
  setProxyTmdb: (value: boolean) => void;
  setTorrentMaxSizeBytes: (value: string) => void;
  setLanguage: (value: string) => void;
  setTheme: (value: string) => void;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  autoplay: true,
  skipCredits: false,
  autoSkipSegments: false,
  autoResumeOnPlaybackError: true,
  enableDoubleClickToSeek: false,
  proxyTmdb: false,
  torrentMaxSizeBytes: String(5 * 1024 * 1024 * 1024),
  language: 'en',
  theme: 'ember',
  setAutoplay: (autoplay) => set({ autoplay }),
  setSkipCredits: (skipCredits) => set({ skipCredits }),
  setAutoSkipSegments: (autoSkipSegments) => set({ autoSkipSegments }),
  setAutoResumeOnPlaybackError: (autoResumeOnPlaybackError) =>
    set({ autoResumeOnPlaybackError }),
  setEnableDoubleClickToSeek: (enableDoubleClickToSeek) =>
    set({ enableDoubleClickToSeek }),
  setProxyTmdb: (proxyTmdb) => set({ proxyTmdb }),
  setTorrentMaxSizeBytes: (torrentMaxSizeBytes) => set({ torrentMaxSizeBytes }),
  setLanguage: (language) => set({ language }),
  setTheme: (theme) => set({ theme }),
}));
