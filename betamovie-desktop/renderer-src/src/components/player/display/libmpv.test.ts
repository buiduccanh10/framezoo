import { afterEach, describe, expect, it, vi } from "vitest";

import { makeLibMpvDisplayInterface } from "./libmpv";

type Source = {
  type: "mp4";
  url: string;
};

function makeElement() {
  return {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 640,
      height: 360,
    }),
  } as unknown as HTMLElement;
}

describe("libmpv display", () => {
  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it("keeps only the latest load when player creation is shared", async () => {
    const loads: Array<{ url: string }> = [];
    const createPlayer = vi.fn().mockResolvedValue("player-1");
    const loadPlayer = vi.fn((_: string, request: { url: string }) => {
      loads.push({ url: request.url });
      return Promise.resolve(true);
    });

    (window as any).electronAPI = {
      createLibMpvPlayer: createPlayer,
      loadLibMpvSource: loadPlayer,
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn().mockReturnValue(() => undefined),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.load({
      source: { type: "mp4", url: "https://example.test/old.mkv" } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });
    display.load({
      source: { type: "mp4", url: "https://example.test/new.mkv" } as Source,
      startAt: 12,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createPlayer).toHaveBeenCalledTimes(1);
    expect(loads).toEqual([{ url: "https://example.test/new.mkv" }]);
    display.destroy();
  });

  it("maps authoritative properties and excludes video tracks", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: "property";
          name: string;
          data: unknown;
        }) => void)
      | undefined;
    const audioTracks: unknown[] = [];
    const durations: number[] = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("duration", (duration) => durations.push(duration));
    display.on("audiotracks", (tracks) => audioTracks.push(tracks));
    const source = {
      type: "mp4",
      url: "https://example.test/video.mkv",
    } as Source;
    display.load({
      source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "property",
      name: "duration",
      data: 120,
    });
    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "property",
      name: "track-list",
      data: JSON.stringify([
        { id: 1, type: "video", title: "Video" },
        { id: 2, type: "audio", lang: "en", title: "English" },
        { id: 3, type: "sub", lang: "vi", title: "Vietnamese" },
      ]),
    });

    expect(durations).toEqual([120]);
    expect(audioTracks.at(-1)).toEqual([
      { id: "2", label: "English", language: "en" },
    ]);
    display.destroy();
  });

  it("keeps the loading overlay until libmpv renders the first frame", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: "file-loaded" | "video-reconfig" | "video-frame";
        }) => void)
      | undefined;
    const loading: boolean[] = [];
    const rendered: number[] = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("loading", (isLoading) => loading.push(isLoading));
    display.on("rendered", () => rendered.push(1));
    display.load({
      source: {
        type: "mp4",
        url: "https://example.test/video.mkv",
      } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "file-loaded",
    });
    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "video-reconfig",
    });
    expect(loading).toEqual([true]);

    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "video-frame",
    });
    expect(loading).toEqual([true, false]);
    expect(rendered).toEqual([1]);
    display.destroy();
  });

  it("queues the app play action across native player creation and load", async () => {
    const commands: Array<{ type: string }> = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn((_id: string, command: { type: string }) => {
        commands.push(command);
        return Promise.resolve(true);
      }),
      onLibMpvEvent: vi.fn().mockReturnValue(() => undefined),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.load({
      source: {
        type: "mp4",
        url: "http://127.0.0.1/video.mkv",
      } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
      autoplay: false,
    });
    display.play();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(commands.at(-1)).toEqual({ type: "play" });
    display.destroy();
  });

  it("resets generation when clearing the native player", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: "property";
          name: string;
          data: unknown;
        }) => void)
      | undefined;
    const durations: number[] = [];
    const createPlayer = vi
      .fn()
      .mockResolvedValueOnce("player-1")
      .mockResolvedValueOnce("player-2");

    (window as any).electronAPI = {
      createLibMpvPlayer: createPlayer,
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      destroyLibMpvPlayer: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("duration", (duration) => durations.push(duration));

    const source = (url: string) => ({ type: "mp4", url }) as Source;
    display.load({
      source: source("https://example.test/first.mkv"),
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    display.load({
      source: null,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });
    display.load({
      source: source("https://example.test/second.mkv"),
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    eventListener?.({
      playerId: "player-2",
      generation: 1,
      type: "property",
      name: "duration",
      data: 120,
    });

    expect(durations).toEqual([120]);
    expect(createPlayer).toHaveBeenCalledTimes(2);
    display.destroy();
  });

  it("destroys the native player when the source is cleared", async () => {
    const destroyPlayer = vi.fn().mockResolvedValue(true);

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      destroyLibMpvPlayer: destroyPlayer,
      onLibMpvEvent: vi.fn().mockReturnValue(() => undefined),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.load({
      source: {
        type: "mp4",
        url: "https://example.test/video.mkv",
      } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    display.load({
      source: null,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(destroyPlayer).toHaveBeenCalledWith("player-1");
  });
});
