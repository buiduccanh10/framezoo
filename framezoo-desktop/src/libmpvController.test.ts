import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => "/tmp",
  },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn() },
  screen: {
    getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
  },
}));

import { LibMpvController } from "./libmpvController";

describe("libmpv suspend/resume lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Mirrors Electron powerMonitor's suspend -> resume sequence with an active stream.
  it("pauses native playback before sleep and resumes only after wake settles", () => {
    const native = {
      commandPlayer: vi.fn(),
      setPlayerSuspended: vi.fn(),
    };
    const controller = new LibMpvController() as any;
    controller.addon = native;
    controller.players.set("player-1", {
      id: "player-1",
      generation: 4,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      target: "main",
      isPaused: false,
    });

    controller.pauseAllForSuspend();

    expect(native.setPlayerSuspended).toHaveBeenCalledWith("player-1", true);
    expect(native.commandPlayer).toHaveBeenCalledWith("player-1", {
      type: "pause",
    });

    controller.resumeAllForSuspend();
    expect(native.setPlayerSuspended).not.toHaveBeenCalledWith(
      "player-1",
      false,
    );

    vi.advanceTimersByTime(1_000);
    expect(native.setPlayerSuspended).toHaveBeenCalledWith("player-1", false);
    expect(native.commandPlayer).toHaveBeenLastCalledWith("player-1", {
      type: "pause",
    });

    vi.advanceTimersByTime(50);
    expect(native.commandPlayer).toHaveBeenLastCalledWith("player-1", {
      type: "play",
    });
  });

  it("does not replay a player destroyed while wake is settling", () => {
    const native = {
      commandPlayer: vi.fn(),
      destroyPlayer: vi.fn(),
      setPlayerSuspended: vi.fn(),
    };
    const controller = new LibMpvController() as any;
    controller.addon = native;
    controller.players.set("player-1", {
      id: "player-1",
      generation: 4,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      target: "main",
      isPaused: false,
    });

    controller.pauseAllForSuspend();
    controller.resumeAllForSuspend();
    controller.destroy("player-1", "test");

    vi.advanceTimersByTime(1_050);

    expect(native.destroyPlayer).toHaveBeenCalledWith("player-1");
    expect(native.commandPlayer).not.toHaveBeenCalledWith("player-1", {
      type: "play",
    });
  });

  it("does not throw when the renderer died during sleep", () => {
    const native = {
      commandPlayer: vi.fn(),
      setPlayerSuspended: vi.fn(),
    };
    const send = vi.fn();
    const controller = new LibMpvController() as any;
    controller.addon = native;
    controller.mainWindow = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => true,
        send,
      },
    };
    controller.players.set("player-1", {
      id: "player-1",
      generation: 4,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      target: "main",
      isPaused: false,
    });

    expect(() => controller.pauseAllForSuspend()).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("swallows a renderer send race during sleep", () => {
    const native = {
      commandPlayer: vi.fn(),
      setPlayerSuspended: vi.fn(),
    };
    const send = vi.fn(() => {
      throw new Error("Object has been destroyed");
    });
    const controller = new LibMpvController() as any;
    controller.addon = native;
    controller.mainWindow = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send,
      },
    };
    controller.players.set("player-1", {
      id: "player-1",
      generation: 4,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      target: "main",
      isPaused: false,
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(() => controller.pauseAllForSuspend()).not.toThrow();
    expect(send).toHaveBeenCalledWith("desktop:libmpv-log", {
      level: "debug",
      name: "pause",
      data: { playerId: "player-1", generation: 4, playbackId: "player-1" },
    });
  });
});
