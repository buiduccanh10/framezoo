import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type { TorrentProfile } from "@/desktop/torrentTypes";
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  KeyboardShortcuts,
} from "@/utils/keyboardShortcuts";

export const DEFAULT_HOME_SECTIONS = [
  "trending",
  "popular",
  "providers",
  "top-rated",
  "editor-picks",
  "latest",
  "for-you",
  "recommendations",
  "genres",
  "addons",
];

export type AudioOutputMode = "auto" | "stereo-dialogue" | "passthrough";

export interface PreferencesStore {
  audioOutputMode: AudioOutputMode;
  enableAutoplay: boolean;
  enableTrailer: boolean;
  enableTrailerAudio: boolean;
  enableSkipCredits: boolean;
  enableAutoSkipSegments: boolean;
  autoUpdateEnabled: boolean;
  proxyTmdb: boolean;
  febboxKey: string | null;
  febboxUseMp4: boolean;
  debridToken: string | null;
  debridService: string;
  tidbKey: string | null;
  enableDoubleClickToSeek: boolean;
  enableAutoResumeOnPlaybackError: boolean;
  enableNumberKeySeeking: boolean;
  keyboardShortcuts: KeyboardShortcuts;
  torrentMaxSize: string | null;
  torrentCacheRoot: string | null;
  torrentProfile: TorrentProfile;
  homeSectionOrder: string[];

  setAudioOutputMode(v: AudioOutputMode): void;
  setEnableAutoplay(v: boolean): void;
  setEnableTrailer(v: boolean): void;
  setEnableTrailerAudio(v: boolean): void;
  setEnableSkipCredits(v: boolean): void;
  setEnableAutoSkipSegments(v: boolean): void;
  setAutoUpdateEnabled(v: boolean): void;
  setProxyTmdb(v: boolean): void;
  setFebboxKey(v: string | null): void;
  setFebboxUseMp4(v: boolean): void;
  setdebridToken(v: string | null): void;
  setdebridService(v: string): void;
  setTIDBKey(v: string | null): void;
  setEnableDoubleClickToSeek(v: boolean): void;
  setEnableAutoResumeOnPlaybackError(v: boolean): void;
  setEnableNumberKeySeeking(v: boolean): void;
  setKeyboardShortcuts(v: KeyboardShortcuts): void;
  setTorrentMaxSize(v: string | null): void;
  setTorrentCacheRoot(v: string | null): void;
  setTorrentProfile(v: TorrentProfile): void;
  setHomeSectionOrder(v: string[]): void;
}

export const usePreferencesStore = create(
  persist(
    immer<PreferencesStore>((set) => ({
      audioOutputMode: "auto",
      enableAutoplay: true,
      enableTrailer: true,
      enableTrailerAudio: false,
      enableSkipCredits: false,
      enableAutoSkipSegments: false,
      autoUpdateEnabled: true,
      proxyTmdb: false,
      febboxKey: null,
      febboxUseMp4: false,
      debridToken: null,
      debridService: "realdebrid",
      tidbKey: null,
      enableDoubleClickToSeek: true,
      enableAutoResumeOnPlaybackError: true,
      enableNumberKeySeeking: true,
      keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
      torrentMaxSize: null,
      torrentCacheRoot: null,
      torrentProfile: "default",
      homeSectionOrder: DEFAULT_HOME_SECTIONS,

      setAudioOutputMode(v) {
        set((s) => {
          s.audioOutputMode = v;
        });
      },
      setEnableAutoplay(v) {
        set((s) => {
          s.enableAutoplay = v;
        });
      },
      setEnableTrailer(v) {
        set((s) => {
          s.enableTrailer = v;
        });
      },
      setEnableTrailerAudio(v) {
        set((s) => {
          s.enableTrailerAudio = v;
        });
      },
      setEnableSkipCredits(v) {
        set((s) => {
          s.enableSkipCredits = v;
        });
      },
      setEnableAutoSkipSegments(v) {
        set((s) => {
          s.enableAutoSkipSegments = v;
        });
      },
      setAutoUpdateEnabled(v) {
        set((s) => {
          s.autoUpdateEnabled = v;
        });
      },
      setProxyTmdb(v) {
        set((s) => {
          s.proxyTmdb = v;
        });
      },
      setFebboxKey(v) {
        set((s) => {
          s.febboxKey = v;
        });
      },
      setFebboxUseMp4(v) {
        set((s) => {
          s.febboxUseMp4 = v;
        });
      },
      setdebridToken(v) {
        set((s) => {
          s.debridToken = v;
        });
      },
      setdebridService(v) {
        set((s) => {
          s.debridService = v;
        });
      },
      setTIDBKey(v) {
        set((s) => {
          s.tidbKey = v;
        });
      },
      setEnableDoubleClickToSeek(v) {
        set((s) => {
          s.enableDoubleClickToSeek = v;
        });
      },
      setEnableAutoResumeOnPlaybackError(v) {
        set((s) => {
          s.enableAutoResumeOnPlaybackError = v;
        });
      },
      setEnableNumberKeySeeking(v) {
        set((s) => {
          s.enableNumberKeySeeking = v;
        });
      },
      setKeyboardShortcuts(v) {
        set((s) => {
          s.keyboardShortcuts = v;
        });
      },
      setTorrentMaxSize(v) {
        set((s) => {
          s.torrentMaxSize = v;
        });
      },
      setTorrentCacheRoot(v) {
        set((s) => {
          s.torrentCacheRoot = v;
        });
      },
      setTorrentProfile(v) {
        set((s) => {
          s.torrentProfile = v;
        });
      },
      setHomeSectionOrder(v) {
        set((s) => {
          s.homeSectionOrder = v;
        });
      },
    })),
    {
      name: "__MW::preferences",
    },
  ),
);
