import { create } from 'zustand';

interface ThemeState {
  themeId: string;
  setThemeId: (themeId: string) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  themeId: 'ember',
  setThemeId: (themeId) => set({ themeId }),
}));
