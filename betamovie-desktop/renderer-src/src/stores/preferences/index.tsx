import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  KeyboardShortcuts,
} from "@/utils/keyboardShortcuts";

export interface PreferencesStore {
  enableAutoplay: boolean;
  enableSkipCredits: boolean;
  enableAutoSkipSegments: boolean;
  lastSuccessfulSource: string | null;
  embedOrder: string[];
  enableEmbedOrder: boolean;
  proxyTmdb: boolean;
  febboxKey: string | null;
  febboxUseMp4: boolean;
  debridToken: string | null;
  debridService: string;
  tidbKey: string | null;
  manualSourceSelection: boolean;
  enableDoubleClickToSeek: boolean;
  enableAutoResumeOnPlaybackError: boolean;
  enableNumberKeySeeking: boolean;
  keyboardShortcuts: KeyboardShortcuts;

  setEnableAutoplay(v: boolean): void;
  setEnableSkipCredits(v: boolean): void;
  setEnableAutoSkipSegments(v: boolean): void;
  setLastSuccessfulSource(v: string | null): void;
  setEmbedOrder(v: string[]): void;
  setEnableEmbedOrder(v: boolean): void;
  setProxyTmdb(v: boolean): void;
  setFebboxKey(v: string | null): void;
  setFebboxUseMp4(v: boolean): void;
  setdebridToken(v: string | null): void;
  setdebridService(v: string): void;
  setTIDBKey(v: string | null): void;
  setManualSourceSelection(v: boolean): void;
  setEnableDoubleClickToSeek(v: boolean): void;
  setEnableAutoResumeOnPlaybackError(v: boolean): void;
  setEnableNumberKeySeeking(v: boolean): void;
  setKeyboardShortcuts(v: KeyboardShortcuts): void;
}

export const usePreferencesStore = create(
  persist(
    immer<PreferencesStore>((set) => ({
      enableAutoplay: true,
      enableSkipCredits: false,
      enableAutoSkipSegments: false,
      lastSuccessfulSource: null,
      embedOrder: [],
      enableEmbedOrder: false,
      proxyTmdb: false,
      febboxKey: null,
      febboxUseMp4: false,
      debridToken: null,
      debridService: "realdebrid",
      tidbKey: null,
      manualSourceSelection: false,
      enableDoubleClickToSeek: true,
      enableAutoResumeOnPlaybackError: true,
      enableNumberKeySeeking: true,
      keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,

      setEnableAutoplay(v) {
        set((s) => {
          s.enableAutoplay = v;
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
      setLastSuccessfulSource(v) {
        set((s) => {
          s.lastSuccessfulSource = v;
        });
      },
      setEmbedOrder(v) {
        set((s) => {
          s.embedOrder = v;
        });
      },
      setEnableEmbedOrder(v) {
        set((s) => {
          s.enableEmbedOrder = v;
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
      setManualSourceSelection(v) {
        set((s) => {
          s.manualSourceSelection = v;
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
    })),
    {
      name: "__MW::preferences",
    },
  ),
);
