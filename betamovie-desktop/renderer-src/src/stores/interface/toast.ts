import { create } from "zustand";

interface ToastState {
  toast: { message: string; type?: "success" | "error" | "info" } | null;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  hideToast: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toast: null,
  showToast: (message, type = "success") => set({ toast: { message, type } }),
  hideToast: () => set({ toast: null }),
}));
