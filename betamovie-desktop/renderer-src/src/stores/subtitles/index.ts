import merge from "lodash.merge";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import { isFirefox } from "@/utils/detectFeatures";

export interface SubtitleStyling {
  /**
   * Text color of subtitles, hex string
   */
  color: string;

  /**
   * size percentage, ranges between 0.01 and 2
   */
  size: number;

  /**
   * background opacity, ranges between 0 and 1
   */
  backgroundOpacity: number;

  /**
   * background blur, ranges between 0 and 1
   */
  backgroundBlur: number;

  /**
   * whether background blur is enabled (disabled by default on Firefox due to flickering issues)
   */
  backgroundBlurEnabled: boolean;

  /**
   * bold, boolean
   */
  bold: boolean;

  /**
   * vertical position percentage, ranges between 1 and 3 (rem)
   */
  verticalPosition: number;

  /**
   * font style for text rendering
   * "default" | "raised" | "depressed" | "Border" | "dropShadow"
   */
  fontStyle: string;

  /**
   * border thickness for Border font style, ranges between 0 and 10
   */
  borderThickness: number;
}

export interface SubtitleCuePopupData {
  direction: -1 | 1;
  start: number;
  content: string;
}

interface SubtitleCuePopupStore {
  popup: SubtitleCuePopupData | null;
  setPopup(popup: SubtitleCuePopupData | null): void;
}

export interface SubtitleStore {
  lastSync: {
    lastSelectedLanguage: string | null;
  };
  enabled: boolean;
  lastSelectedLanguage: string | null;
  isOpenSubtitles: boolean;
  styling: SubtitleStyling;
  overrideCasing: boolean;
  delay: number;
  updateStyling(newStyling: Partial<SubtitleStyling>): void;
  resetStyling(): void;
  setLanguage(language: string | null): void;
  setIsOpenSubtitles(isOpenSubtitles: boolean): void;
  setCustomSubs(): void;
  setOverrideCasing(enabled: boolean): void;
  setDelay(delay: number): void;
  importSubtitleLanguage(lang: string | null): void;
  resetSubtitleSpecificSettings(): void;
}

export const DEFAULT_SUBTITLE_STYLING: SubtitleStyling = {
  color: "#ffffff",
  backgroundOpacity: 0,
  size: 1.65,
  backgroundBlur: 0.5,
  backgroundBlurEnabled: !isFirefox,
  bold: false,
  verticalPosition: 1,
  fontStyle: "default",
  borderThickness: 1,
};

const LEGACY_PLAYER_RESET_SUBTITLE_STYLING: SubtitleStyling = {
  color: "#ffffff",
  backgroundOpacity: 0.25,
  size: 0.75,
  backgroundBlur: 0.25,
  backgroundBlurEnabled: !isFirefox,
  bold: false,
  verticalPosition: 1,
  fontStyle: "default",
  borderThickness: 1,
};

function matchesSubtitleStyling(
  styling: Partial<SubtitleStyling> | undefined,
  target: SubtitleStyling,
) {
  if (!styling) return false;

  return (
    styling.color === target.color &&
    styling.backgroundOpacity === target.backgroundOpacity &&
    styling.size === target.size &&
    styling.backgroundBlur === target.backgroundBlur &&
    styling.backgroundBlurEnabled === target.backgroundBlurEnabled &&
    styling.bold === target.bold &&
    styling.verticalPosition === target.verticalPosition &&
    styling.fontStyle === target.fontStyle &&
    styling.borderThickness === target.borderThickness
  );
}

export const useSubtitleStore = create(
  persist(
    immer<SubtitleStore>((set) => ({
      enabled: false,
      lastSync: {
        lastSelectedLanguage: null,
      },
      lastSelectedLanguage: null,
      isOpenSubtitles: false,
      overrideCasing: false,
      delay: 0,
      styling: { ...DEFAULT_SUBTITLE_STYLING },
      resetSubtitleSpecificSettings() {
        set((s) => {
          s.delay = 0;
          s.overrideCasing = false;
        });
      },
      updateStyling(newStyling) {
        set((s) => {
          if (newStyling.backgroundOpacity !== undefined)
            s.styling.backgroundOpacity = Math.min(
              1,
              Math.max(0, newStyling.backgroundOpacity),
            );
          if (newStyling.backgroundBlur !== undefined)
            s.styling.backgroundBlur = Math.min(
              1,
              Math.max(0, newStyling.backgroundBlur),
            );
          if (newStyling.backgroundBlurEnabled !== undefined)
            s.styling.backgroundBlurEnabled = newStyling.backgroundBlurEnabled;
          if (newStyling.color !== undefined)
            s.styling.color = newStyling.color.toLowerCase();
          if (newStyling.size !== undefined)
            s.styling.size = Math.min(10, Math.max(0.01, newStyling.size));
          if (newStyling.bold !== undefined) s.styling.bold = newStyling.bold;
          if (newStyling.verticalPosition !== undefined)
            s.styling.verticalPosition = Math.min(
              100,
              Math.max(0, newStyling.verticalPosition),
            );
          if (newStyling.fontStyle !== undefined)
            s.styling.fontStyle = newStyling.fontStyle;
          if (newStyling.borderThickness !== undefined)
            s.styling.borderThickness = Math.min(
              10,
              Math.max(0, newStyling.borderThickness),
            );
        });
      },
      resetStyling() {
        set((s) => {
          s.styling = { ...DEFAULT_SUBTITLE_STYLING };
        });
      },
      setLanguage(lang) {
        set((s) => {
          s.enabled = !!lang;
          if (lang) s.lastSelectedLanguage = lang;
        });
      },
      setIsOpenSubtitles(isOpenSubtitles) {
        set((s) => {
          s.isOpenSubtitles = isOpenSubtitles;
        });
      },
      setCustomSubs() {
        set((s) => {
          s.enabled = true;
          s.lastSelectedLanguage = null;
        });
      },
      setOverrideCasing(enabled) {
        set((s) => {
          s.overrideCasing = enabled;
        });
      },
      setDelay(delay) {
        set((s) => {
          s.delay = Number.isFinite(delay) ? delay : 0;
        });
      },
      importSubtitleLanguage(lang) {
        set((s) => {
          s.lastSelectedLanguage = lang;
          s.lastSync.lastSelectedLanguage = lang;
        });
      },
    })),
    {
      name: "__MW::subtitles",
      version: 3,
      migrate: (persistedState: unknown, version: number) => {
        if (!persistedState || typeof persistedState !== "object") {
          return persistedState;
        }

        const state = persistedState as {
          styling?: Partial<SubtitleStyling>;
        };

        if (!state.styling) return state;

        // Migrate old defaults:
        // - size: 100% (1.0) -> 165% in UI (1.65 * 1.5 in renderer em)
        // - background opacity: 50% -> 0%
        if (version < 2) {
          if (state.styling.size === 1) {
            state.styling.size = 1.65;
          }
          if (state.styling.backgroundOpacity === 0.5) {
            state.styling.backgroundOpacity = 0;
          }
        }

        if (
          version < 3 &&
          matchesSubtitleStyling(
            state.styling,
            LEGACY_PLAYER_RESET_SUBTITLE_STYLING,
          )
        ) {
          state.styling = { ...DEFAULT_SUBTITLE_STYLING };
        }

        return state;
      },
      merge: (persisted, current) => merge({}, current, persisted),
    },
  ),
);

export const useSubtitleCuePopupStore = create<SubtitleCuePopupStore>(
  (set) => ({
    popup: null,
    setPopup(popup) {
      set({ popup });
    },
  }),
);
