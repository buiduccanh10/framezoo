import { create } from "zustand";

interface AppUpdateState {
  hasUpdate: boolean;
  isUpdating: boolean;
  markUpdateAvailable: () => void;
  clearUpdate: () => void;
  setIsUpdating: (isUpdating: boolean) => void;
}

export const useAppUpdateStore = create<AppUpdateState>((set) => ({
  hasUpdate: false,
  isUpdating: false,
  markUpdateAvailable: () =>
    set({
      hasUpdate: true,
      isUpdating: false,
    }),
  clearUpdate: () =>
    set({
      hasUpdate: false,
      isUpdating: false,
    }),
  setIsUpdating: (isUpdating) =>
    set((state) => ({
      ...state,
      isUpdating,
    })),
}));
