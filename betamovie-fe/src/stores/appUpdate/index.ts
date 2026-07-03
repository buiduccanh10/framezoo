import { create } from "zustand";

import { DesktopAppUpdateStatus } from "@/desktop/electron";
import { APP_VERSION } from "@/setup/constants";

const APP_UPDATE_REMINDER_STORAGE_KEY = "app-update-reminder";
export const APP_UPDATE_REMINDER_MS = 30 * 60 * 1000;

interface AppUpdateReminder {
  token: string;
  remindAt: number;
}

interface AppUpdateState {
  hasUpdate: boolean;
  isUpdating: boolean;
  status: DesktopAppUpdateStatus;
  updateToken: string | null;
  updateVersion: string | null;
  progressPercent: number | null;
  errorMessage: string | null;
  markChecking: () => void;
  markUpdateAvailable: (payload?: {
    updateToken?: string;
    updateVersion?: string | null;
  }) => void;
  markUpdateDownloaded: (payload?: {
    updateToken?: string;
    updateVersion?: string | null;
  }) => void;
  setUpdateProgress: (progressPercent: number) => void;
  markUpdateError: (errorMessage?: string | null) => void;
  clearUpdate: () => void;
  snoozeUpdate: () => void;
  syncUpdateVisibility: () => void;
}

let reminderTimer: number | null = null;

function clearReminderTimer() {
  if (reminderTimer === null || typeof window === "undefined") return;
  window.clearTimeout(reminderTimer);
  reminderTimer = null;
}

function readUpdateReminder(): AppUpdateReminder | null {
  if (typeof window === "undefined") return null;

  try {
    const rawReminder = window.localStorage.getItem(
      APP_UPDATE_REMINDER_STORAGE_KEY,
    );
    if (!rawReminder) return null;

    const parsedReminder = JSON.parse(
      rawReminder,
    ) as Partial<AppUpdateReminder>;
    if (
      typeof parsedReminder.token !== "string" ||
      typeof parsedReminder.remindAt !== "number"
    ) {
      return null;
    }

    return {
      token: parsedReminder.token,
      remindAt: parsedReminder.remindAt,
    };
  } catch {
    return null;
  }
}

function writeUpdateReminder(reminder: AppUpdateReminder | null) {
  if (typeof window === "undefined") return;

  try {
    if (!reminder) {
      window.localStorage.removeItem(APP_UPDATE_REMINDER_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      APP_UPDATE_REMINDER_STORAGE_KEY,
      JSON.stringify(reminder),
    );
  } catch {
    // Ignore storage errors and fall back to in-memory behavior.
  }
}

function scheduleReminderCheck(updateToken: string, remindAt: number) {
  if (typeof window === "undefined") return;

  clearReminderTimer();
  reminderTimer = window.setTimeout(
    () => {
      const state = useAppUpdateStore.getState();
      if (state.updateToken !== updateToken) return;
      state.syncUpdateVisibility();
    },
    Math.max(remindAt - Date.now(), 0),
  );
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  hasUpdate: false,
  isUpdating: false,
  status: "idle",
  updateToken: null,
  updateVersion: null,
  progressPercent: null,
  errorMessage: null,
  markChecking: () => {
    clearReminderTimer();
    writeUpdateReminder(null);
    set({
      hasUpdate: false,
      isUpdating: true,
      status: "checking",
      progressPercent: null,
      errorMessage: null,
    });
  },
  markUpdateAvailable: (payload) => {
    clearReminderTimer();
    set({
      updateToken: payload?.updateToken ?? APP_VERSION,
      updateVersion: payload?.updateVersion ?? null,
      status: "available",
      progressPercent: null,
      errorMessage: null,
      isUpdating: false,
    });
    get().syncUpdateVisibility();
  },
  markUpdateDownloaded: (payload) => {
    clearReminderTimer();
    set({
      updateToken: payload?.updateToken ?? APP_VERSION,
      updateVersion: payload?.updateVersion ?? null,
      status: "downloaded",
      progressPercent: 100,
      errorMessage: null,
      isUpdating: false,
    });
    get().syncUpdateVisibility();
  },
  setUpdateProgress: (progressPercent) => {
    clearReminderTimer();
    set({
      hasUpdate: false,
      isUpdating: true,
      status: "downloading",
      progressPercent,
      errorMessage: null,
    });
  },
  markUpdateError: (errorMessage) => {
    clearReminderTimer();
    set({
      hasUpdate: false,
      isUpdating: false,
      status: "error",
      progressPercent: null,
      errorMessage: errorMessage ?? null,
    });
  },
  clearUpdate: () => {
    clearReminderTimer();
    writeUpdateReminder(null);
    set({
      hasUpdate: false,
      isUpdating: false,
      status: "idle",
      updateToken: null,
      updateVersion: null,
      progressPercent: null,
      errorMessage: null,
    });
  },
  snoozeUpdate: () => {
    const { updateToken, updateVersion, status } = get();

    if (!updateToken) {
      set({
        hasUpdate: false,
        isUpdating: false,
      });
      return;
    }

    const remindAt = Date.now() + APP_UPDATE_REMINDER_MS;
    writeUpdateReminder({
      token: updateToken,
      remindAt,
    });
    scheduleReminderCheck(updateToken, remindAt);
    set({
      hasUpdate: false,
      isUpdating: false,
      status,
      updateVersion,
    });
  },
  syncUpdateVisibility: () => {
    const { updateToken, isUpdating, status } = get();

    if (!updateToken || isUpdating) return;
    if (status !== "available" && status !== "downloaded") {
      set({
        hasUpdate: false,
      });
      return;
    }

    const reminder = readUpdateReminder();

    if (!reminder) {
      clearReminderTimer();
      set({
        hasUpdate: true,
        isUpdating: false,
      });
      return;
    }

    if (reminder.token !== updateToken || reminder.remindAt <= Date.now()) {
      clearReminderTimer();
      writeUpdateReminder(null);
      set({
        hasUpdate: true,
        isUpdating: false,
      });
      return;
    }

    scheduleReminderCheck(updateToken, reminder.remindAt);
    set({
      hasUpdate: false,
      isUpdating: false,
    });
  },
}));
