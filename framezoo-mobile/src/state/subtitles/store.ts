import { create } from 'zustand';

interface SubtitleState {
  language: string;
  fontSize: number;
  delayMs: number;
  setLanguage: (language: string) => void;
  setFontSize: (fontSize: number) => void;
  setDelayMs: (delayMs: number) => void;
}

export const useSubtitleStore = create<SubtitleState>((set) => ({
  language: 'en',
  fontSize: 18,
  delayMs: 0,
  setLanguage: (language) => set({ language }),
  setFontSize: (fontSize) => set({ fontSize }),
  setDelayMs: (delayMs) => set({ delayMs }),
}));
