import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAutoUpdater } = vi.hoisted(() => {
  const listeners: Record<string, Function[]> = {};
  const emitter = {
    on: vi.fn((event: string, fn: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
      return emitter;
    }),
    emit: vi.fn((event: string, ...args: any[]) => {
      (listeners[event] || []).forEach((fn) => fn(...args));
      return true;
    }),
    removeAllListeners: vi.fn(() => {
      for (const k of Object.keys(listeners)) {
        delete listeners[k];
      }
      return emitter;
    }),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    setFeedURL: vi.fn(),
    quitAndInstall: vi.fn(),
    autoDownload: false,
    autoInstallOnAppQuit: false,
  };
  return { mockAutoUpdater: emitter };
});

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getVersion: () => "2.1.7",
    quit: vi.fn(),
  },
}));

vi.mock("electron-updater", () => ({
  autoUpdater: mockAutoUpdater,
}));

import { createDesktopAppUpdater } from "./desktopAppUpdater";

describe("createDesktopAppUpdater - pre-download update checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAutoUpdater.removeAllListeners();
  });

  it("checks for updates and downloads immediately when the version is unchanged", async () => {
    const stateChanges: any[] = [];
    const updater = createDesktopAppUpdater({
      appName: "Framezoo",
      checkIntervalMs: 60000,
      releaseOwner: "framezoo",
      releaseRepo: "framezoo",
      onStateChange: (s) => stateChanges.push(s),
    });

    updater.initialize();

    // Simulate initial check found 2.1.8
    mockAutoUpdater.emit("update-available", { version: "2.1.8" });
    expect(updater.getState().updateVersion).toBe("2.1.8");
    expect(updater.getState().status).toBe("available");

    // Pre-check returns same version 2.1.8
    mockAutoUpdater.checkForUpdates.mockImplementation(async () => {
      mockAutoUpdater.emit("update-available", { version: "2.1.8" });
      return { updateInfo: { version: "2.1.8" } };
    });
    mockAutoUpdater.downloadUpdate.mockResolvedValue(true);

    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      const result = await updater.downloadUpdate();
      expect(result).toBe(true);
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalled();
      expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalled();
      expect(updater.getState().updateVersion).toBe("2.1.8");
      expect(updater.getState().versionBump).toBeNull();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      updater.dispose();
    }
  });

  it("detects newer version 2.1.9 when 2.1.8 was cached and auto-downloads 2.1.9 (Option A / default UX)", async () => {
    const stateChanges: any[] = [];
    const updater = createDesktopAppUpdater({
      appName: "Framezoo",
      checkIntervalMs: 60000,
      releaseOwner: "framezoo",
      releaseRepo: "framezoo",
      autoDownloadNewerVersion: true,
      onStateChange: (s) => stateChanges.push(s),
    });

    updater.initialize();

    // Initially found 2.1.8
    mockAutoUpdater.emit("update-available", { version: "2.1.8" });
    expect(updater.getState().updateVersion).toBe("2.1.8");

    // During pre-download check, GitHub releases has new version 2.1.9
    mockAutoUpdater.checkForUpdates.mockImplementation(async () => {
      mockAutoUpdater.emit("update-available", { version: "2.1.9" });
      return { updateInfo: { version: "2.1.9" } };
    });
    mockAutoUpdater.downloadUpdate.mockResolvedValue(true);

    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      const result = await updater.downloadUpdate();
      expect(result).toBe(true);
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalled();
      expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalled();

      // Verified state was bumped to 2.1.9
      const state = updater.getState();
      expect(state.updateVersion).toBe("2.1.9");
      expect(state.versionBump).toEqual({
        from: "2.1.8",
        to: "2.1.9",
      });
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      updater.dispose();
    }
  });

  it("detects newer version 2.1.9 and pauses with available status when autoDownloadNewerVersion is false (Option B)", async () => {
    const stateChanges: any[] = [];
    const updater = createDesktopAppUpdater({
      appName: "Framezoo",
      checkIntervalMs: 60000,
      releaseOwner: "framezoo",
      releaseRepo: "framezoo",
      autoDownloadNewerVersion: false,
      onStateChange: (s) => stateChanges.push(s),
    });

    updater.initialize();

    // Initially cached 2.1.8
    mockAutoUpdater.emit("update-available", { version: "2.1.8" });

    // Pre-download check finds 2.1.9
    mockAutoUpdater.checkForUpdates.mockImplementation(async () => {
      mockAutoUpdater.emit("update-available", { version: "2.1.9" });
      return { updateInfo: { version: "2.1.9" } };
    });

    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      const result = await updater.downloadUpdate();
      // Should pause and return false, NOT proceed to downloadUpdate
      expect(result).toBe(false);
      expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled();

      const state = updater.getState();
      expect(state.status).toBe("available");
      expect(state.updateVersion).toBe("2.1.9");
      expect(state.versionBump).toEqual({
        from: "2.1.8",
        to: "2.1.9",
      });
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      updater.dispose();
    }
  });

  it("resets to idle and does not download when pre-check reports update is not available", async () => {
    const updater = createDesktopAppUpdater({
      appName: "Framezoo",
      checkIntervalMs: 60000,
      releaseOwner: "framezoo",
      releaseRepo: "framezoo",
    });

    updater.initialize();

    // Initially thought 2.1.8 was available
    mockAutoUpdater.emit("update-available", { version: "2.1.8" });

    // Pre-check finds that no update is available anymore (already on latest or revoked)
    mockAutoUpdater.checkForUpdates.mockImplementation(async () => {
      mockAutoUpdater.emit("update-not-available");
      return null;
    });

    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      const result = await updater.downloadUpdate();
      expect(result).toBe(false);
      expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled();
      expect(updater.getState().status).toBe("idle");
      expect(updater.getState().updateVersion).toBeNull();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      updater.dispose();
    }
  });

  it("handles pre-check network errors gracefully", async () => {
    const updater = createDesktopAppUpdater({
      appName: "Framezoo",
      checkIntervalMs: 60000,
      releaseOwner: "framezoo",
      releaseRepo: "framezoo",
    });

    updater.initialize();
    mockAutoUpdater.emit("update-available", { version: "2.1.8" });

    mockAutoUpdater.checkForUpdates.mockRejectedValue(
      new Error("Network connection lost"),
    );

    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      const result = await updater.downloadUpdate();
      expect(result).toBe(false);
      expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled();
      expect(updater.getState().status).toBe("available");
      expect(updater.getState().errorMessage).toBe("Network connection lost");
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      updater.dispose();
    }
  });

  it("waits for an idle machine before auto-downloading", async () => {
    let isIdle = false;
    const updater = createDesktopAppUpdater({
      appName: "Framezoo",
      checkIntervalMs: 60000,
      releaseOwner: "framezoo",
      releaseRepo: "framezoo",
      autoDownloadWhenIdle: () => isIdle,
    });

    mockAutoUpdater.checkForUpdates.mockImplementation(async () => {
      mockAutoUpdater.emit("update-available", { version: "2.1.8" });
      return { updateInfo: { version: "2.1.8" } };
    });
    mockAutoUpdater.downloadUpdate.mockResolvedValue(true);

    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      updater.initialize();
      await updater.checkForUpdate();
      expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled();

      isIdle = true;
      updater.setAutoUpdateEnabled(true);
      await vi.waitFor(() => {
        expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalled();
      });
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      updater.dispose();
    }
  });
});
