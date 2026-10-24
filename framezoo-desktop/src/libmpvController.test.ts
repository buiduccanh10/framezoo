import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("electron", () => {
  let isStarted = false;
  let nextId = 1;
  return {
    app: {
      isPackaged: false,
      getPath: () => "/tmp",
    },
    BrowserWindow: vi.fn(),
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
    },
    screen: {
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    powerSaveBlocker: {
      start: vi.fn(() => {
        isStarted = true;
        return nextId++;
      }),
      stop: vi.fn(() => {
        isStarted = false;
      }),
      isStarted: vi.fn(() => isStarted),
    },
  };
});

import { powerSaveBlocker } from "electron";
import { LibMpvController } from "./libmpvController";

describe("LibMpvController display sleep prevention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("activates powerSaveBlocker when a player is loading with autoplay=true", () => {
    const controller = new LibMpvController();
    const fakeAddon: any = {
      createPlayer: vi.fn(() => "player-1"),
      loadPlayer: vi.fn(),
      commandPlayer: vi.fn(),
      destroyPlayer: vi.fn(),
    };
    (controller as any).addon = fakeAddon;
    (controller as any).mainWindow = {
      isDestroyed: () => false,
      getContentSize: () => [800, 600],
      getNativeWindowHandle: () => Buffer.from("fake-handle"),
      on: vi.fn(),
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    };

    const id = controller.create({ x: 0, y: 0, width: 800, height: 600 });
    expect(id).toBe("player-1");

    // Initially created but not loaded yet: desiredPaused = true, blocker should not start
    expect(powerSaveBlocker.start).not.toHaveBeenCalled();

    // Now load a stream with autoplay=true (desiredPaused = false, fileLoaded = false)
    controller.load(id!, {
      url: "http://example.com/stream.mp4",
      type: "file",
      startAt: 0,
      autoplay: true,
    });

    // Should activate prevent-display-sleep while loading/buffering
    expect(powerSaveBlocker.start).toHaveBeenCalledWith("prevent-display-sleep");

    // When paused by user command, should stop blocker
    controller.command(id!, { type: "pause" });
    expect(powerSaveBlocker.stop).toHaveBeenCalled();

    // When resumed by user command, should restart blocker
    controller.command(id!, { type: "play" });
    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(2);

    // Destroy player stops blocker
    controller.destroy(id!);
    expect(powerSaveBlocker.stop).toHaveBeenCalledTimes(2);
  });

  it("keeps screen awake during torrent buffer stalls (paused-for-cache)", () => {
    const controller = new LibMpvController();
    const fakeAddon: any = {
      createPlayer: vi.fn(() => "player-2"),
      loadPlayer: vi.fn(),
      commandPlayer: vi.fn(),
      destroyPlayer: vi.fn(),
    };
    (controller as any).addon = fakeAddon;
    (controller as any).mainWindow = {
      isDestroyed: () => false,
      getContentSize: () => [800, 600],
      getNativeWindowHandle: () => Buffer.from("fake-handle"),
      on: vi.fn(),
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    };

    const id = controller.create({ x: 0, y: 0, width: 800, height: 600 });
    controller.load(id!, {
      url: "http://127.0.0.1:4000/torrent/stream",
      type: "file",
      startAt: 0,
      autoplay: true,
      isTorrent: true,
    });

    expect(powerSaveBlocker.start).toHaveBeenCalledWith("prevent-display-sleep");

    // Simulate file-loaded event from mpv
    (controller as any).handleNativeEvent({
      playerId: id,
      generation: (controller as any).players.get(id).generation,
      type: "file-loaded",
    });

    // Still awake because desiredPaused is false and it's active
    expect(powerSaveBlocker.stop).not.toHaveBeenCalled();

    // Simulate mpv stalling for cache (mpv emits pause: true and paused-for-cache: true)
    (controller as any).handleNativeEvent({
      playerId: id,
      generation: (controller as any).players.get(id).generation,
      type: "property",
      name: "paused-for-cache",
      data: true,
    });
    (controller as any).handleNativeEvent({
      playerId: id,
      generation: (controller as any).players.get(id).generation,
      type: "property",
      name: "pause",
      data: true,
    });

    // Must NOT stop powerSaveBlocker while buffering torrent
    expect(powerSaveBlocker.stop).not.toHaveBeenCalled();

    // When cache resumes
    (controller as any).handleNativeEvent({
      playerId: id,
      generation: (controller as any).players.get(id).generation,
      type: "property",
      name: "paused-for-cache",
      data: false,
    });
    (controller as any).handleNativeEvent({
      playerId: id,
      generation: (controller as any).players.get(id).generation,
      type: "property",
      name: "pause",
      data: false,
    });

    expect(powerSaveBlocker.stop).not.toHaveBeenCalled();

    // Real pause by user stops it
    controller.command(id!, { type: "pause" });
    expect(powerSaveBlocker.stop).toHaveBeenCalled();
  });
});
